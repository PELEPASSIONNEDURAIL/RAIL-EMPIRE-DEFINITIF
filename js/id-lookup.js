/** Preserve native find's first match and captured length without a per-slot
 * callback or an index that could hide public in-place ID edits/duplicates. */
const nativeFind = Array.prototype.find;
const apply = Reflect.apply;
export function findById(rows, id) {
    const find = rows.find;
    if (!Array.isArray(rows) || find !== nativeFind)
        return apply(find, rows, [(row) => row.id === id]);
    const length = Math.min(Math.max(Math.floor(+rows.length) || 0, 0), Number.MAX_SAFE_INTEGER);
    for (let i = 0; i < length; i++) {
        const row = rows[i];
        if (row.id === id)
            return row;
    }
    return undefined;
}
