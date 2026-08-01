import * as fs from "node:fs/promises";
import { generateID, HttpError, successJSON } from "../../utils/request";
import { Hono } from "hono";
import resolveFormdata from "../../utils/formdata";

export const uploadApp = new Hono();

uploadApp.post("/", async (c) => {
    const url = await uploadFile(c.req.raw);
    return c.json(successJSON({ url: url }));
});

const UPLOAD_PATH = `${process.env.STORAGE_PATH}/uploads`;
const FILE_SIZE_LIMIT = 1024 * 1024 * 128; // 128MB

export async function initUploadSystem() {
    await fs.mkdir(UPLOAD_PATH, { recursive: true });
}

async function uploadFile(req: Request) {
    const { files } = await resolveFormdata(req, FILE_SIZE_LIMIT);

    const filepath = files["file"]?.[0];
    if (!filepath) {
        throw new HttpError(400, "No file uploaded. Please provide a file in the 'file' field.");
    }

    const filename = `${generateID()}.${filepath.split('.').at(-1)}`;
    const dest = `${UPLOAD_PATH}/${filename}`;
    await fs.rename(filepath, dest);

    return `uploads/${filename}`;
}
