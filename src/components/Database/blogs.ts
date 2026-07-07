import { Database } from "bun:sqlite";
import { Document } from "flexsearch";
import { tokenized } from "../../utils/tokenizer";

console.log("Initializing BLOG database and index...");

// main database
const DB_PATH = `${process.env.DB_PATH}/blogs.db`;
const db = new Database(DB_PATH, { create: true });

db.run(`
    CREATE TABLE IF NOT EXISTS blogs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        title TEXT,
        cover TEXT,
        desc TEXT,
        emoji TEXT,
        section TEXT NOT NULL,
        tags TEXT,
        created_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_time TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        completed BOOLEAN
    );
`);

// search index
const blogIndex = new Document({
    id: "id",
    index: [
        {
            field: "title",
            resolution: 10,
        },
        {
            field: "desc",
            resolution: 10,
        },
        {
            field: "content",
            resolution: 1,
        }
    ],
    encoder: tokenized,
});

blogIndex.add({
    id: 0,
    title: "如何用初中Math知识证明Gauss定理？",
    desc: "Some people told me that's impossible, i dont give a fk!",
    content: "首先第一步证明微积分基本定理（Calculus Basic Theroy）。"
});
blogIndex.add({
    id: 1,
    title: "代码里如何读取",
    desc: "sequential structured data",
    content: "解析成绝对路径，方便调试和日志。"
});
blogIndex.add({
    id: 3,
    title: "Bun 的加载规则（同时存在多个文件时，前者覆盖后者",
    desc: "bun --env-file=custom.env index.ts",
    content: "微积分基本定理"
});

function searchBlog(q: string) {
    return blogIndex.search(q);
}

export { blogIndex, searchBlog };
