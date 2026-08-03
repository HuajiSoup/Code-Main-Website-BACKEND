import { Database } from "bun:sqlite";
import { Document } from "flexsearch";
import { Hono } from "hono";
import * as fs from "node:fs/promises";
import { tokenized } from "../../utils/tokenizer";
import type { RawToyInfo } from "../../utils/models";
import { generateID, HttpError, isNormalDirname, isNormalFilename, successJSON } from "../../utils/request";
import resolveFormdata from "../../utils/formdata";
import AdmZip from "adm-zip";

export const toyApp = new Hono();

toyApp
    .get("/", (c) => {
        const q = c.req.query("q");
        return c.json(successJSON({ toys: searchToys({ q }) }));
    })
    .post("/", async (c) => {
        await postToy(c.req.raw);
        return c.json(successJSON({}));
    })
    .get("/:slug", (c) => {
        const slug = c.req.param().slug;
        const res = getToy(slug);
        if (!res) {
            throw new HttpError(404, "This toy does not exist.");
        }
        return c.json(successJSON({ toy: res }));
    })
    .put("/:slug", async (c) => {
        const slug = c.req.param().slug;
        await postToy(c.req.raw, slug);
        return c.json(successJSON({}));
    })
    .delete("/:slug", (c) => {
        const slug = c.req.param().slug;
        deleteToy(slug);
        return c.json(successJSON({}));
    });

const DB_PATH = `${process.env.STORAGE_PATH}/toys.db`;
const STORE_PATH = `${process.env.STORAGE_PATH}/toys`;

let db: Database;
let index: Document;

export async function initToySystem() {
    console.log("\n--- Initializing Toy System ---");

    await fs.mkdir(STORE_PATH, { recursive: true });
    
    db = new Database(DB_PATH, { create: true });
    db.run(`
        CREATE TABLE IF NOT EXISTS toys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            desc TEXT NOT NULL,
            cover TEXT
        );
    `);

    index = new Document({
        id: "slug",
        index: [
            {
                field: "title",
                resolution: 10,
            },
            {
                field: "desc",
                resolution: 4,
            }
        ],
        encoder: tokenized
    });

    const rawToys = db.query("SELECT * FROM toys").all() as RawToyInfo[];
    for (const toy of rawToys) {
        index.add(toy.slug, {
            title: toy.title,
            desc: toy.desc
        });
    }

    console.log(`Toy datebase initialized on [${DB_PATH}], ${rawToys.length} toys loaded.`);
    console.log(`--- Successfully Initialized Toy System ---\n`);
}

function selectAllBySlug(slugs: string[]) {
    const query = db.query("SELECT * FROM toys WHERE slug = ?");
    return slugs.map(slug => query.get(slug) as RawToyInfo | null).filter(s => s !== null);
}

type ToySearchOption = {
    q?: string;
    limit?: number;
    offset?: number;
}

function searchToys({ q, limit = 100, offset = 0 }: ToySearchOption) {
    if (!q) {
        return db.query("SELECT * FROM toys").all() as RawToyInfo[];
    }
    const slugs = index.search(q, { offset, limit, merge: true })
        .map(res => res.id.toString());
    return selectAllBySlug(slugs);
}

function getToy(q: string) {
    return db.query("SELECT * FROM toys WHERE slug = ?").get(q) as RawToyInfo | null;
}

type toyPostOptions = {
    slug: string;
    title: string;
    desc: string;
}
type toyInsertParams = Pick<RawToyInfo, "slug" | "title" | "desc" | "cover">;

async function postToy(req: Request, slug?: string) {
    const { fields, files } = await resolveFormdata(req);

    const tempPath = `${STORE_PATH}/temp-${generateID()}`;
    await fs.mkdir(tempPath, { recursive: true });
    const clearTemp = () => fs.rm(tempPath, { recursive: true }).catch(() => {});
    
    const contentFile = files.content?.[0];
    const coverFile = files.cover?.[0];
    const coverName = coverFile ? (coverFile.split("/").at(-1) ?? null) : null;
    if (coverFile && coverName) await fs.rename(coverFile, `${tempPath}/${coverName}`);

    if (contentFile) {
        const zip = new AdmZip(contentFile);
        zip.getEntries().forEach(entry => {
            if ((entry.isDirectory && isNormalDirname(entry.name))
                || (!entry.isDirectory && isNormalFilename(entry.name))) {
                // pass
            } else {
                clearTemp();
                throw new HttpError(400, `Not supported filename [${entry.name}].`);
            }
        });
    
        try {
            zip.extractEntryTo("index/", tempPath);
        } catch {
            clearTemp();
            throw new HttpError(400, "Can't resolve zip. Need a dir [index/] in zip.");
        }
    }

    if (slug) {
        // it's a put
        const old = db.query("SELECT * FROM toys WHERE slug = ?").get(slug) as RawToyInfo | null;
        if (!old) {
            clearTemp();
            throw new HttpError(400, "This toy does not exist.");
        }
        const oldPath = `${STORE_PATH}/${slug}`;
        const oldIndexPath = `${oldPath}/index`;
        await fs.mkdir(oldIndexPath, { recursive: true });

        const updated: Omit<toyInsertParams, "slug"> = {
            title: fields.title ?? old.title,
            desc: fields.desc ?? old.desc,
            cover: coverName ?? old.cover,
        };

        await fs.rm(oldIndexPath, { recursive: true });
        await fs.mkdir(oldIndexPath, { recursive: true }); // empty index folder
        await fs.cp(tempPath, oldPath, { recursive: true });
        clearTemp();

        db.prepare("UPDATE toys SET title = ?, desc = ?, cover = ? WHERE slug = ?")
            .run(updated.title, updated.desc, updated.cover, slug);
        
        index.update(slug, {
            title: updated.title,
            desc: updated.desc
        });
    } else {
        // it's a new post
        if (!(fields.title && fields.desc && fields.slug && contentFile)) {
            clearTemp();
            throw new HttpError(400, "Lack arguments.");
        }
        const created: toyInsertParams = {
            slug: fields.slug,
            title: fields.title,
            desc: fields.desc,
            cover: coverName,
        };

        const old = db.query("SELECT * FROM toys WHERE slug = ?").get(fields.slug);
        if (old) {
            clearTemp();
            throw new HttpError(400, "This toy already exists.");
        }

        const newPath = `${STORE_PATH}/${created.slug}`;
        await fs.rm(newPath, { recursive: true }).catch(() => {});
        await fs.rename(tempPath, newPath);

        db.prepare("INSERT INTO toys (slug, title, desc, cover) VALUES (?, ?, ?, ?) ")
            .run(created.slug, created.title, created.desc, created.cover);
        
        index.add(created.slug, {
            title: created.title,
            desc: created.desc
        });
    }
}

function deleteToy(slug: string) {
    db.run("DELETE FROM toys WHERE slug = ?", [slug]);
    index.remove(slug);
    fs.rm(`${STORE_PATH}/${slug}`, { recursive: true }).catch(() => {});
    return;
}
