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

export { HttpError, successJSON, failJSON, generateID };