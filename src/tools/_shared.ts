export function textContent(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

interface JsonApiResource { id: string; type: string; attributes?: Record<string, unknown>; }
interface JsonApiDoc { data: JsonApiResource | JsonApiResource[]; }

function flattenOne(r: JsonApiResource) {
  return { id: r.id, type: r.type, ...(r.attributes ?? {}) };
}

export function flattenJsonApi(doc: JsonApiDoc): unknown {
  return Array.isArray(doc.data) ? doc.data.map(flattenOne) : flattenOne(doc.data);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}
