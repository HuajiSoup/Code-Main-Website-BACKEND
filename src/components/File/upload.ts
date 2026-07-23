import busboy from "busboy";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { generateID, HttpError } from "../../utils/request";

const FILE_PATH = `${process.env.STORAGE_PATH}/uploads`;
const FILE_SIZE_LIMIT = 1024 * 1024 * 128; // 128MB

async function uploadFile(req: Request) {
    await mkdir(FILE_PATH, { recursive: true });

    const bb = busboy({
        headers: Object.fromEntries(req.headers.entries()),
        limits: {
            fileSize: FILE_SIZE_LIMIT
        }
    });
    const nodeStream = Readable.fromWeb(req.body as any);

    const rec: Record<string, string> = {};
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
            console.log(`File successfully uploaded.`);
            resolve();
        };

        bb.on("file", (FieldName, fileStream, info) => {
            if (FieldName !== "file") {
                fileStream.resume();
                return;
            }

            const { filename } = info;
            const ext = filename.split(".").at(-1);
            const dest = `${FILE_PATH}/${generateID()}.${ext}`;
            rec[FieldName] = dest;

            console.log(`File uploading! Streaming [${filename}] -> [${dest}]`);
            const writeStream = createWriteStream(dest);
            pendingWrites++;

            fileStream.on("limit", () => {
                writeStream.destroy();
                unlink(dest).catch();
                fail(new HttpError(413, `File [${filename}] exceeds the size limit of 128MB.`));
            });

            fileStream.on("error", (e) => {
                writeStream.destroy();
                unlink(dest).catch();
                fail(new HttpError(400, `Failed to read uploaded file [${filename}]: ${e.message}`));
            });

            writeStream.on("error", (e) => {
                fileStream.destroy();
                unlink(dest).catch();
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
    });

    if (!rec["file"]) {
        throw new HttpError(400, "No file uploaded. Please provide a file in the 'file' field.");
    }

    return rec["file"];
}


export { uploadFile, HttpError };