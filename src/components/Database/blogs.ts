import { Database } from "bun:sqlite";
import { Document } from "flexsearch";
import { tokenized } from "../../utils/tokenizer";
import { standardBlogInfo, type BlogInfo, type RawBlogInfo } from "../../utils/models";
import { Readable } from "node:stream";
import busboy from "busboy";
import { generateID, HttpError } from "../../utils/request";
import * as fs from "node:fs/promises";
import { createWriteStream } from "node:fs";

const DB_PATH = `${process.env.STORAGE_PATH}/blogs.db`;
const STORE_PATH = `${process.env.STORAGE_PATH}/blogs`;

let db: Database;
let blogIndex: Document;

async function initBlogSystem() {
    console.log("\n--- Initializing Blog System ---")
    
    await fs.mkdir(STORE_PATH, { recursive: true });

    db = new Database(DB_PATH, { create: true });
    blogIndex = new Document({
        id: "id",
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
        
        blogIndex.add(blog.id, { title, desc, tags, content });
    }

    console.log(`Blog datebase initialized on [${DB_PATH}], ${rawBlogs.length} blogs loaded.`);
    console.log(`--- Successfully Initialized Blog System ---\n`);
}

// blogIndex.add({
//     id: 0,
//     title: "如何用初中Math知识证明Gauss定理？",
//     desc: "Some people told me that's impossible, i dont give a fk!",
//     content: "首先第一步证明加载微积分基本定理（Calculus Basic Theroy）。",
//     tags: ["数学", "迷思"]
// });
// blogIndex.add({
//     id: 1,
//     title: "代码里如何读取",
//     desc: "sequential structured data",
//     content: "解析成绝对路径，方便调试和日志。",
//     tags: ["React", "迷思"]
// });
// blogIndex.add({
//     id: 3,
//     title: "Bun 的加载规则（同时存在多个文件时，前者覆盖后者",
//     desc: "bun --env-file=custom.env index.ts 是一份代码",
//     content: "微积分基本定理",
//     tags: ["数学"]
// });

function selectAllByID(ids: number[]): BlogInfo[] {
    const query = db.query("SELECT * FROM blogs WHERE id = ?");
    return ids.map(id => standardBlogInfo(query.get(id) as RawBlogInfo));
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
        const ids = (tag ? blogIndex.search(q, {
            tag: { "tags": tag },
            merge: true,
            limit: limit,
            offset: offset,
        }) : blogIndex.search(q, {
            merge: true,
            limit: limit,
            offset: offset
        })).map(res => Number(res.id));
        
        return selectAllByID(ids);
    } else {
        if (tag) {
            const ids = blogIndex.search({
                tag: { "tags": tag },
                merge: true,
                limit: limit,
                offset: offset,
            }).map(res => Number(res.id));

            return selectAllByID(ids);
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
type blogPostOptions = Pick<RawBlogInfo, "slug" | "title" | "desc" | "emoji" | "tags" | "completed" >
type blogPutOptions = { [K in keyof blogPostOptions]?: blogPostOptions[K] };

async function postBlog(req: Request, slug?: string) {
    const bb = busboy({
        headers: Object.fromEntries(req.headers.entries()),
        limits: {
            fileSize: 1024 * 1024 * 16
        }
    });
    const nodeStream = Readable.fromWeb(req.body as any);

    const fields: Record<string, string | boolean> = {};
    const tempSlug = generateID();
    const tempPath = `${STORE_PATH}/${tempSlug}`;
    const clearTemp = async () => { fs.rm(tempPath, { recursive: true }).catch(() => {}); };

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

        bb.on("field", (fieldName, value) => {
            // multipart/form-data 的字段值只能是字符串，这里按 schema 规范化类型
            if (fieldName === "completed") {
                fields[fieldName] = value === "true";
            } else {
                fields[fieldName] = value;
            }
        });

        bb.on("file", (fieldName, fileStream, info) => {
            const { filename } = info;
            let dest: string;
            if (fieldName === "content") {
                dest = `${tempPath}/${filename}`;
                hasContent = true;
            } else if (fieldName === "cover") {
                dest = `${tempPath}/${filename}`;
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

        const updated: blogPostOptions = { ...old, ...fields };
        db.prepare(
            "UPDATE blogs SET title = ?, desc = ?, emoji = ?, tags = ?, completed = ?, \
            updated_time = (datetime('now', 'localtime')) WHERE slug = ?",
        ).run(updated.title, updated.desc, updated.emoji, updated.tags, updated.completed, slug);

        await fs.cp(tempPath, oldPath, { recursive: true });
        clearTemp();
    } else {
        // it's a new create
        if (!("slug" in fields && "title" in fields && "desc" in fields && "emoji" in fields 
            && "completed" in fields && "tags" in fields && hasContent)) {
            console.log("lack hit!");
            clearTemp();
            throw new HttpError(400, "Lack arguments.");
        }
        const newPath = `${STORE_PATH}/${fields.slug}`;
        if (await fs.exists(newPath)) {
            clearTemp();
            throw new HttpError(400, "This blog already exists.");
        }

        await fs.rename(tempPath, newPath);
        db.prepare(
            "INSERT INTO blogs (slug, title, desc, emoji, tags, completed) \
            VALUES (?, ?, ?, ?, ?, ?)",
        ).run(fields.slug, fields.title, fields.desc, fields.emoji, fields.tags, fields.completed);
    }
}

export { initBlogSystem, searchBlog, getBlog, postBlog };
