// Copies cultus's OpenAPI document into api-reference/openapi.json for the
// API reference tab: public operations only, with JavaScript, Go and curl
// samples generated from each operation's SDK method (x-linkvite-sdk).
//
//   node scripts/sync-openapi.mjs ../cultus/api/openapi.json
//   node scripts/sync-openapi.mjs https://raw.githubusercontent.com/linkvite/cultus/main/api/openapi.json
import {readFile, writeFile} from 'node:fs/promises';

const src = process.argv[2];
if (!src) {
	console.error('usage: node scripts/sync-openapi.mjs <path-or-url to cultus api/openapi.json>');
	process.exit(2);
}
const spec = JSON.parse(/^https?:/.test(src) ? await (await fetch(src)).text() : await readFile(src, 'utf8'));

const goName = s =>
	s
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.split(/[_\-.]/)
		.map(p => ({id: 'ID', url: 'URL', api: 'API', rss: 'RSS', csv: 'CSV', html: 'HTML'})[p.toLowerCase()] ?? p[0].toUpperCase() + p.slice(1).toLowerCase())
		.join('');

const resolve = s => (s?.$ref ? spec.components.schemas[s.$ref.split('/').pop()] : s);

function example(schema, depth = 0) {
	const s = resolve(schema) ?? {};
	if (s.anyOf) return example(s.anyOf.find(x => x.type !== 'null'), depth);
	const type = Array.isArray(s.type) ? s.type.find(t => t !== 'null') : s.type;
	if (s.enum) return s.enum[0];
	switch (type) {
		case 'string':
			return s.format === 'uri' ? 'https://example.com' : s.format === 'email' ? 'you@example.com' : s.format === 'binary' ? '<file>' : 'string';
		case 'integer':
		case 'number':
			return s.minimum ?? 1;
		case 'boolean':
			return true;
		case 'array':
			return depth > 2 ? [] : [example(s.items, depth + 1)];
		case 'object': {
			const out = {};
			for (const k of s.required ?? []) out[k] = depth > 2 ? {} : example(s.properties?.[k], depth + 1);
			return out;
		}
	}
	return null;
}

const nice = {url: 'https://example.com', bookmark_id: 'bmk_123', collection: 'col_123', name: 'Reading list', title: 'Read later', content: 'Great read', identifier: 'you@example.com'};
function bodyExample(op) {
	const c = op.requestBody?.content ?? {};
	const s = c['application/json']?.schema ?? c['multipart/form-data']?.schema;
	if (!s) return null;
	const ex = example(s);
	for (const k of Object.keys(ex ?? {})) if (nice[k] && typeof ex[k] === 'string') ex[k] = nice[k];
	return ex;
}

const jsLiteral = (v, indent = '') =>
	JSON.stringify(v, null, '\t')
		.replace(/"([a-zA-Z_][a-zA-Z0-9_]*)":/g, '$1:')
		.replace(/"<file>"/g, "new File([bytes], 'file.pdf')")
		.replace(/\n/g, '\n' + indent);

function goLiteral(v, typeName, indent = '') {
	if (v === null || typeof v !== 'object' || Array.isArray(v)) return '';
	const fields = Object.entries(v).map(([k, x]) => {
		let val;
		if (x === '<file>') val = 'linkvite.File{Name: "file.pdf", Reader: f}';
		else if (typeof x === 'string') val = JSON.stringify(x);
		else if (typeof x === 'number' || typeof x === 'boolean') val = String(x);
		else return null;
		return `${indent}\t${goName(k)}: ${val},`;
	});
	return `&linkvite.${typeName}{\n${fields.filter(Boolean).join('\n')}\n${indent}}`;
}

let ops = 0;
for (const [p, item] of Object.entries(spec.paths)) {
	for (const [m, op] of Object.entries(item)) {
		if (op['x-linkvite-visibility'] !== 'public') {
			delete item[m];
			continue;
		}
		delete op['x-linkvite-middlewares'];
		ops++;
		const meta = [];
		if (op['x-linkvite-scopes']?.length) meta.push(`**Scope:** \`${op['x-linkvite-scopes'].join('`, `')}\``);
		if (op['x-linkvite-rate-limit']) meta.push(`**Rate limit:** ${op['x-linkvite-rate-limit'].replace(/\/(\d+)min$/, ' requests per $1 minutes')}`);
		if (meta.length) op.description = [op.description, meta.join(' · ')].filter(Boolean).join('\n\n');
		const pathParams = [...p.matchAll(/\{([^}]+)\}/g)].map(x => x[1]);
		const sdk = op['x-linkvite-sdk'];
		const body = bodyExample(op);
		const multipart = !!op.requestBody?.content?.['multipart/form-data'];
		const auth = op.security?.length ? `  -H "x-api-key: $LINKVITE_API_KEY" \\\n` : '';
		const curlBody = body
			? multipart
				? Object.entries(body)
						.map(([k, v]) => `  -F "${k}=${v === '<file>' ? '@file.pdf' : v}" \\\n`)
						.join('')
				: `  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}' \\\n`
			: '';
		const samples = [
			{lang: 'bash', label: 'curl', source: `curl -X ${m.toUpperCase()} "https://api.linkvite.io${p.replace(/\{([^}]+)\}/g, '<$1>')}" \\\n${auth}${curlBody}`.replace(/ \\\n$/, '\n')},
		];
		const returnsData = Object.entries(op.responses).some(
			([c, r]) => c.startsWith('2') && r.content && (r.content['application/json']?.schema?.properties?.data || !r.content['application/json']),
		);
		if (sdk) {
			const [ns, method] = sdk.split('.');
			const jsArgs = pathParams.map(x => `'<${x}>'`);
			if (body) jsArgs.push(jsLiteral(body));
			samples.push({
				lang: 'javascript',
				label: 'JavaScript',
				source: `import {Linkvite} from '@linkvite/js';\n\nconst linkvite = new Linkvite(process.env.LINKVITE_API_KEY);\n${returnsData ? 'const data = ' : ''}await linkvite.${ns}.${method}(${jsArgs.join(', ')});`,
			});
			const svc = goName(ns);
			const goArgs = ['ctx', ...pathParams.map(x => `"<${x}>"`)];
			if (body) {
				const t = op.requestBody.content['application/json']?.schema?.$ref?.split('/').pop();
				goArgs.push(goLiteral(body, t ? goName(t) : `${svc}${goName(method)}Request`));
			}
			if ((op.parameters ?? []).some(x => x.in === 'query')) goArgs.push('nil');
			samples.push({
				lang: 'go',
				label: 'Go',
				source: `client, _ := linkvite.NewClient(os.Getenv("LINKVITE_API_KEY"))\n${returnsData ? 'data, err' : 'err'} := client.${svc}.${goName(method)}(${goArgs.join(', ')})`,
			});
		}
		op['x-codeSamples'] = samples;
	}
	if (Object.keys(item).length === 0) delete spec.paths[p];
}
spec.tags = spec.tags.filter(t => Object.values(spec.paths).some(item => Object.values(item).some(op => op.tags?.includes(t.name))));

await writeFile(new URL('../api-reference/openapi.json', import.meta.url), JSON.stringify(spec, null, 2) + '\n');
console.log(`api-reference/openapi.json: ${ops} public operations, API ${spec.info.version}`);
