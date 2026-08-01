import type { ContentfulStatusCode } from "hono/utils/http-status";

class HttpError extends Error {
    public status: ContentfulStatusCode;

    constructor(status: ContentfulStatusCode, message: string) {
        super(message);
        this.status = status;
    }
}

type SuccessRes = {
    success: true,
    data: object,
    message?: string,
};

type FailRes = {
    success: false,
    data: null,
    code: number,
    message?: string,
}

function successJSON<T extends object>(body: T, message: string = "ok"): SuccessRes {
    return {
        success: true,
        data: body,
        message: message
    };
}

function failJSON(code: number, message?: string): FailRes {
    return {
        success: false,
        data: null,
        code: code,
        message: message
    };
}

function generateID() {
    const timeID = (Date.now() * 2 + 1145).toString(16).toUpperCase();
    const rand = Math.pow(Math.random(), 0.75).toString(36).substring(2, 10).toUpperCase();
    return `${timeID}-${rand}`;
}

const SAFE_EXT = new Set([
    "jpg", "png", "jpeg", "ico", "bmp", "gif", "webp", "svg",
    "mp3", "wmv", "wav", "mp4", "avi", "mpeg", "mov", "flv",
    "zip", "rar", "7z", "gz",
    "txt", "md", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
]);

function isNormalString(str: string) {
    return /^[a-zA-Z0-9\-_.]+$/.test(str);
}

function isNormalFilename(filename: string) {
    const dot = filename.lastIndexOf(".");
    if (dot === -1 || dot === 0) return false;

    const name = filename.substring(0, dot);
    const ext = filename.substring(dot + 1);
    if (!SAFE_EXT.has(ext)) return false;

    return isNormalString(name);
}

export { HttpError, successJSON, failJSON, generateID, isNormalString, isNormalFilename };