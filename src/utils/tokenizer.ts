function isChinese(char: string) {
    const code = char.charCodeAt(0);
    return 0x004E00 <= code && code <= 0x009FFF;
}

function isNormal(char: string) {
    const code = char.charCodeAt(0);
    return (code >= 97 && code <= 122)
        || (code >= 65 && code <= 90)
        || (code >= 48 && code <= 57);
}

function tokenized(sentence: string) {
    const tokens: string[] = [];

    const len = sentence.length;
    let i = 0;
    while (i < len) {
        const c = sentence[i];
        if (!c) break;

        if (isChinese(c)) {
            tokens.push(c);
            i++;
        } else if (isNormal(c)) {
            // it's a word
            let j = i+1;
            for (; j < len; j++) {
                if (!isNormal(sentence[j] || ' ')) break;
            }
            tokens.push(sentence.slice(i, j).toUpperCase());
            i = j;
        } else {
            i++;
        }
    }

    return tokens;
}

export { tokenized };