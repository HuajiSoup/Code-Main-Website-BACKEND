type SuccessRes = {
    success: true,
    data: object,
    message?: string,
};

type FailRes = {
    success: false,
    code: number,
    message: string,
}

function success_json<T extends object>(body: T, message?: string): SuccessRes {
    return {
        success: true,
        data: body,
        message: message
    };
}

export { success_json };