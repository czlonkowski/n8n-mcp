"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTypeVersion = parseTypeVersion;
exports.isValidTypeVersion = isValidTypeVersion;
function parseTypeVersion(value) {
    if (value == null)
        return null;
    if (typeof value === 'number') {
        return Number.isFinite(value) && value >= 0 ? value : null;
    }
    if (Array.isArray(value)) {
        let max = null;
        for (const item of value) {
            const n = parseTypeVersion(item);
            if (n !== null && (max === null || n > max))
                max = n;
        }
        return max;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed)
            return null;
        if (trimmed.startsWith('[')) {
            try {
                return parseTypeVersion(JSON.parse(trimmed));
            }
            catch {
                return null;
            }
        }
        if (trimmed.includes(',')) {
            return parseTypeVersion(trimmed.split(',').map((s) => s.trim()));
        }
        if ((trimmed.match(/\./g) || []).length > 1)
            return null;
        const n = Number(trimmed);
        return Number.isFinite(n) && n >= 0 ? n : null;
    }
    return null;
}
function isValidTypeVersion(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
//# sourceMappingURL=typeversion.js.map