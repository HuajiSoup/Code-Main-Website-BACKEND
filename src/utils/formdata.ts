import busboy from "busboy";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import { Readable } from "node:stream";
import { generateID, HttpError, isNormalFilename } from "./request";

const DEFAULT_MAX_SIZE = 1024 * 1024 * 32; // 32MB

const STORE_PATH = `${process.env.STORAGE_PATH}/uploads`;

export default async function resolveFormdata(
    req: Request, 
    maxSize: number = DEFAULT_MAX_SIZE,
) {
    const bb = busboy({
        headers: Object.fromEntries(req.headers.entries()),
        limits: {
            fileSize: maxSize
        }
    });
    const nodeStream = Readable.fromWeb(req.body as any);

    const tempPath = `${STORE_PATH}/form_data-${generateID()}`;
    await fs.mkdir(tempPath, { recursive: true });

    const clearTemp = () => {
        fs.rm(tempPath, { recursive: true })
            .catch(() => console.log(`Failed to remove temp upload path [${tempPath}]`));
    };

    const fields: Record<string, string> = {};
    const files: Record<string, string[]> = {};
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let pendingWrites = 0;
        let bbFinished = false;

        const fail = (err: HttpError) => {
            if (settled) return;
            settled = true;
            console.log(`File failed to upload: ${err.message}`);
            reject(err);
        };

        const tryResolve = () => {
            if (settled) return;
            if (!bbFinished || pendingWrites > 0) return;
            settled = true;
            resolve();
        };

        bb.on("field", (fieldName, value) => {
            fields[fieldName] = value;
        });

        bb.on("file", (fieldName, fileStream, info) => {
            const { filename: filename } = info;
            if (!isNormalFilename(filename)) {
                fileStream.destroy();
                fail(new HttpError(400, `Not supported filename [${filename}].`));
            }

            const dest = `${tempPath}/${filename}`;
            if (files[fieldName]) {
                files[fieldName].push(dest);
            } else {
                files[fieldName] = [dest];
            }

            console.log(`File now streaming [${filename}] -> [${dest}]`);
            const writeStream = createWriteStream(dest);
            pendingWrites++;

            fileStream.on("limit", () => {
                writeStream.destroy();
                fail(new HttpError(413, `File [${filename}] exceeds the file size limit.`));
            });

            fileStream.on("error", (e) => {
                writeStream.destroy();
                fail(new HttpError(400, `Failed to read uploaded file [${filename}]: ${e.message}`));
            });

            writeStream.on("error", (e) => {
                fileStream.destroy();
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
            fail(new HttpError(400, `Request stream error: ${e.message}`));
        });

        nodeStream.pipe(bb);
    })
    .finally(() => {
        setTimeout(clearTemp, 300_000); // 5min
    });

    return { fields, files };
}