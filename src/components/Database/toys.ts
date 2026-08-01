import { Database } from "bun:sqlite";
import { Document } from "flexsearch";
import { Hono } from "hono";
import * as fs from "node:fs/promises";
import { tokenized } from "../../utils/tokenizer";
import type { RawToyInfo } from "../../utils/models";
import { successJSON } from "../../utils/request";

export const toyApp = new Hono();

toyApp
    .get("/", (c) => {
        const q = c.req.query("q");
        return c.json(successJSON({ toys: searchToys({ q }) }));
    })
    .get("/:slug", (c) => {
        const slug = c.req.param().slug;
        return c.json(successJSON({ toy: getToy(slug) }));
    })

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
            desc TEXT NOT NULL
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
    return db.query("SELECT * FROM toys WHERE slug = ?").get(q) as RawToyInfo;
}
