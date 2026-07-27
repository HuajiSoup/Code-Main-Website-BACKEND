import { Database } from "bun:sqlite";
import { Document } from "flexsearch";
import { tokenized } from "../../utils/tokenizer";
import { standardBlogInfo, type BlogInfo, type RawBlogInfo } from "../../utils/models";
import { Readable } from "node:stream";
import busboy from "busboy";
import { generateID, HttpError, successJSON } from "../../utils/request";
import * as fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Hono } from "hono";

export const blogApp = new Hono();

blogApp
    .get("/", (c) => {
        const q = c.req.query("q");
        const tag = c.req.query("tag");
        return c.json(successJSON({ items: searchBlog({ q, tag }) }));
    })
    .post("/", async (c) => {
        await postBlog(c.req.raw);
        return c.json(successJSON({}));
    })
    .get("/:slug", (c) => {
        const slug = c.req.param().slug;
        const res = getBlog(slug);
        if (!res) {
            throw new HttpError(404, "The blog does not exist.");
        }
        return c.json(successJSON({ blog: res }));
    })
    .put("/:slug", async (c) => {
        const slug = c.req.param().slug;
        await postBlog(c.req.raw, slug);
        return c.json(successJSON({}));
    })
    .delete("/:slug", (c) => {
        const slug = c.req.param().slug;
        deleteBlog(slug);
        return c.json(successJSON({}));
    });

const DB_PATH = `${process.env.STORAGE_PATH}/blogs.db`;
const STORE_PATH = `${process.env.STORAGE_PATH}/blogs`;

let db: Database;
let blogIndex: Document;

export async function initBlogSystem() {
    console.log("\n--- Initializing Blog System ---")
    
    await fs.mkdir(STORE_PATH, { recursive: true });

    db = new Database(DB_PATH, { create: true });
    blogIndex = new Document({
        id: "slug",
        tag: "tags",
        index: [
            {
                field: "title",
                resolution: 12,
            },
            {
                field: "desc",
                resolution: 12,
            },
            {
                field: "content",
                resolution: 3,
            }
        ],
        encoder: tokenized,
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS blogs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            desc TEXT NOT NULL,
            emoji TEXT NOT NULL,
            tags TEXT NOT NULL,
            created_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            completed BOOLEAN NOT NULL
        );
    `);

    // original index
    type BlogInfoForIndex = Pick<RawBlogInfo, "id" | "slug" | "title" | "desc" | "tags">

    const rawBlogs = db.query(`SELECT id, slug, title, desc, tags FROM blogs`).all() as BlogInfoForIndex[];
    for (const blog of rawBlogs) {
        const title = blog.title ?? "";
        const desc = blog.desc ?? "";
        const tags = blog.tags ? blog.tags.split(",") : [];
        const file = Bun.file(`${STORE_PATH}/${blog.slug}/blog.md`);
        const content = await file.exists() ? await file.text() : "";
        
        blogIndex.add(blog.slug, { title, desc, tags, content });
    }

    console.log(`Blog datebase initialized on [${DB_PATH}], ${rawBlogs.length} blogs loaded.`);
    console.log(`--- Successfully Initialized Blog System ---\n`);
}

function selectAllBySlug(slugs: string[]): BlogInfo[] {
    const query = db.query("SELECT * FROM blogs WHERE slug = ?");
    return slugs.map(slug => query.get(slug) as RawBlogInfo | null)
        .map(b => b ? standardBlogInfo(b) : null).filter(b => b !== null);
}

// /api/blogs
type blogSearchOption = {
    q?: string,
    tag?: string,
    limit?: number,
    offset?: number
};

function searchBlog({ q, tag, limit = 100, offset = 0 }: blogSearchOption): BlogInfo[] {
    if (q) {
        const slugs = (tag ? blogIndex.search(q, {
            tag: { "tags": tag },
            merge: true,
            limit: limit,
            offset: offset,
        }) : blogIndex.search(q, {
            merge: true,
            limit: limit,
            offset: offset
        })).map(res => res.id.toString());
        
        return selectAllBySlug(slugs);
    } else {
        if (tag) {
            const slugs = blogIndex.search({
                tag: { "tags": tag },
                limit: limit,
                offset: offset,
            }).flatMap(res => res.result.map(id => id.toString()));

            return selectAllBySlug(slugs);
        } else {
            return (db.query("SELECT * FROM blogs").all() as RawBlogInfo[]).map(standardBlogInfo);
        }
    }
}

// /api/blog/:slug GET
function getBlog(slug: string): BlogInfo | null {
    const raw = db.query("SELECT * FROM blogs WHERE slug = ?").get(slug) as RawBlogInfo | null;
    if (!raw) return null;
    return standardBlogInfo(raw);
}

// /api/blog POST, /api/blog/:slug PUT
// from form-data, so all strings
// type blogPostOptions = Pick<RawBlogInfo, "slug" | "title" | "desc" | "emoji" | "tags" | "completed" >
type blogPostOptions = {
    slug: string,
    title: string,
    desc: string,
    emoji: string,
    tags: string,
    completed: string,
};
type blogInsertParam = Pick<RawBlogInfo,
    "slug" | "title" | "desc" | "emoji" | "tags" | "completed">;

async function postBlog(req: Request, slug?: string) {
    const bb = busboy({
        headers: Object.fromEntries(req.headers.entries()),
        limits: {
            fileSize: 1024 * 1024 * 16
        }
    });
    const nodeStream = Readable.fromWeb(req.body as any);

    const fields: Record<string, string> = {};
    const tempSlug = generateID();
    const tempPath = `${STORE_PATH}/${tempSlug}`;
    const clearTemp = () => { fs.rm(tempPath, { recursive: true }).catch(() => {}); };

    let hasContent = false;

    await fs.mkdir(`${tempPath}/res`, { recursive: true });
    await new Promise<void>((resolve, reject) => {
        let pendingWrites = 0;
        let settled = false;
        let bbFinished = false;

        const fail = (err: HttpError) => {
            if (settled) return;
            settled = true;
            console.log(`File failed to upload: ${err.message}`);
            reject(err);
        }

        const tryResolve = () => {
            if (settled) return;
            if (!bbFinished || pendingWrites > 0) return;
            settled = true;
            resolve();
        }

        bb.on("field", (fieldName: keyof blogPostOptions, value) => {
            fields[fieldName] = value;
        });

        bb.on("file", (fieldName, fileStream, info) => {
            const { filename } = info;
            let dest: string;
            if (fieldName === "content") {
                dest = `${tempPath}/blog.md`;
                hasContent = true;
            } else if (fieldName === "cover") {
                dest = `${tempPath}/cover.png`;
            } else if (fieldName === "res") {
                dest = `${tempPath}/res/${filename}`;
            } else {
                fileStream.resume();
                return;
            }

            const writeStream = createWriteStream(dest);
            pendingWrites++;

            fileStream.on("limit", () => {
                writeStream.destroy();
                clearTemp(); // end the whole process
                fail(new HttpError(413, `File [${filename}] exceeds the size limit of 16MB.`));
            });

            fileStream.on("error", (e) => {
                writeStream.destroy();
                clearTemp();
                fail(new HttpError(400, `Failed to read uploaded file [${filename}]: ${e.message}`));
            });

            writeStream.on("error", (e) => {
                fileStream.destroy();
                clearTemp();
                fail(new HttpError(500, `Failed to write file [${filename}] to disk: ${e.message}`));
            });

            writeStream.on("finish", () => {
                pendingWrites--;
                tryResolve();
            });

            fileStream.pipe(writeStream);
        });

        bb.on("finish", () => {
            bbFinished = true;
            tryResolve();
        });

        bb.on("error", (e: Error) => {
            fail(new HttpError(400, `Can't resolve this request: ${e.message}`));
        });

        nodeStream.on("error", (e: Error) => {
            fail(new HttpError(400, `Request Stream error: ${e.message}`));
        });

        nodeStream.pipe(bb);
    });

    if (slug) {
        // it's a put
        const old = db.query("SELECT * FROM blogs WHERE slug = ?").get(slug) as RawBlogInfo | null;
        if (!old) {
            clearTemp();
            throw new HttpError(400, "This blog does not exist.");
        }
        const oldPath = `${STORE_PATH}/${slug}`;
        if (!await fs.exists(oldPath)) {
            clearTemp();
            throw new HttpError(400, "This blog does not exist.");
        }

        const updated: Omit<blogInsertParam, "slug"> = { 
            title: fields.title ?? old.title,
            desc: fields.desc ?? old.desc,
            emoji: fields.emoji ?? old.emoji,
            tags: fields.tags ?? old.tags,
            completed: "completed" in fields ? 
                fields.completed === "true" ? 1 : 0
                : old.completed
        };
        await fs.cp(tempPath, oldPath, { recursive: true });
        clearTemp();

        db.prepare(
            "UPDATE blogs SET title = ?, desc = ?, emoji = ?, tags = ?, completed = ?, \
            updated_time = (datetime('now', 'localtime')) WHERE slug = ?",
        ).run(updated.title, updated.desc, updated.emoji, updated.tags, updated.completed, slug);

        const content = await Bun.file(`${oldPath}/blog.md`).text();
        blogIndex.update(slug, {
            title: updated.title,
            desc: updated.desc,
            tags: updated.tags ? updated.tags.split(',') : [],
            content: content
        });
    } else {
        // it's a new post
        if (!("slug" in fields && "title" in fields && "desc" in fields && "emoji" in fields 
            && "completed" in fields && "tags" in fields && hasContent)) {
            clearTemp();
            throw new HttpError(400, "Lack arguments.");
        }
        const created: blogInsertParam = {
            slug: fields.slug,
            title: fields.title,
            desc: fields.desc,
            emoji: fields.emoji,
            tags: fields.tags,
            completed: fields.completed === "true" ? 1 : 0
        };

        const newPath = `${STORE_PATH}/${created.slug}`;
        if (await fs.exists(newPath)) {
            clearTemp();
            throw new HttpError(400, "This blog already exists.");
        }

        await fs.rename(tempPath, newPath);
        db.prepare(
            "INSERT INTO blogs (slug, title, desc, emoji, tags, completed) \
            VALUES (?, ?, ?, ?, ?, ?)",
        ).run(created.slug, created.title, created.desc, created.emoji, created.tags, created.completed);

        const content = await Bun.file(`${newPath}/blog.md`).text();
        blogIndex.add(created.slug, {
            title: created.title,
            desc: created.desc,
            tags: created.tags ? created.tags.split(',') : [],
            content: content
        });
    }
}

// /api/blog/:slug DELETE
function deleteBlog(slug: string) {
    db.run("DELETE FROM blogs WHERE slug = ?", [slug]);
    blogIndex.remove(slug);
    fs.rm(`${STORE_PATH}/${slug}`, { recursive: true }).catch(() => {});
    return;
}
