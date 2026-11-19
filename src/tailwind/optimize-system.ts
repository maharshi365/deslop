import type { __unstable__loadDesignSystem } from "@tailwindcss/node";

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;
type Candidate = ReturnType<DesignSystem["parseCandidate"]>[number];
type AstNode = ReturnType<DesignSystem["compileAstNodes"]>[number]["node"];
type Variant = NonNullable<ReturnType<DesignSystem["parseVariant"]>>;

interface Utility {
	kind: string;
	options?: { types?: Array<string> };
	compileFn(candidate: Candidate): Array<AstNode> | null | undefined;
}

/** Tailwind's per-signature-options table: `get(options)` returns a table for those options. */
interface OptionsTable<T> {
	get(options: object): T;
}

interface SignatureTable {
	get(utility: string): string | symbol;
}

interface StorageKeys {
	readonly precomputed: symbol;
	readonly signatures: symbol;
	readonly compare: symbol;
}

const EMPTY: ReadonlyArray<string> = Object.freeze([]);
// `toCss` prints one declaration per line as `property: value;`.
const DECLARATION = /^\s*(-?-?[A-Za-z_][-\w]*): /gm;

/** Tailwind's `isValidSpacingMultiplier`: these modifiers are computed, not precomputed. */
function isComputedModifier(modifier: string): boolean {
	const number = Number(modifier);
	return number >= 0 && number % 0.25 === 0 && String(number) === modifier;
}

/**
 * Join declared properties into a sorted, duplicate-free key. Sorts the list in place.
 *
 * A signature drops a `--tw-*` declaration when a sibling declares its value under a real
 * property, so `--tw-*` properties count only for utilities that declare nothing else.
 */
function propertyKey(properties: Array<string>): string {
	if (properties.length === 0) return "";
	if (properties.length === 1) return singlePropertyKey(properties[0]);
	properties.sort();
	const variablesOnly = properties.every(property => property.startsWith("--tw-"));
	let key = variablesOnly ? "--tw" : "";
	let previous: string | null = null;
	for (const property of properties) {
		if (property === previous || (!variablesOnly && property.startsWith("--tw-"))) continue;
		key = key === "" ? property : `${key}\0${property}`;
		previous = property;
	}
	return key;
}

function singlePropertyKey(property: string): string {
	return property.startsWith("--tw-") ? `--tw\0${property}` : property;
}

function visitProperties(node: AstNode, properties: Array<string>): void {
	if (node.kind === "at-rule" && node.name === "@property") return;
	if (node.kind === "declaration" && node.value !== undefined && node.property !== "--tw-sort") properties.push(node.property);
	if ("nodes" in node) for (const child of node.nodes) visitProperties(child, properties);
}

function isFallback(utility: Utility): boolean {
	const types = utility.options?.types;
	return types !== undefined && types.length > 1 && types.includes("any");
}

/** Collect declared properties through utility compilers, without selectors, sorting, or `@apply`. */
function compiledProperties(system: DesignSystem, candidate: Candidate, properties: Array<string>): void {
	if (candidate.kind === "arbitrary") {
		for (const { node } of system.compileAstNodes({ ...candidate, variants: [], important: false })) visitProperties(node, properties);
		return;
	}
	const utilities: Array<Utility> | undefined = system.utilities.get(candidate.root);
	if (utilities === undefined) return;
	for (let pass = 0; pass < 2; pass++) {
		let accepted = false;
		for (const utility of utilities) {
			if (utility.kind !== candidate.kind || isFallback(utility) !== (pass === 1)) continue;
			const nodes = utility.compileFn(candidate);
			if (nodes === null && utility.options?.types?.length) { accepted = true; break; }
			if (nodes === null || nodes === undefined) continue;
			accepted = true;
			for (const node of nodes) visitProperties(node, properties);
		}
		if (accepted) break;
	}
}

/** Read the declared properties of a Tailwind utility signature, which is printed CSS. */
function signatureKey(signature: string): string {
	const first = DECLARATION.exec(signature);
	if (first === null) return "";
	const second = DECLARATION.exec(signature);
	if (second === null) return singlePropertyKey(first[1]);
	const properties = [first[1], second[1]];
	for (let match = DECLARATION.exec(signature); match !== null; match = DECLARATION.exec(signature)) properties.push(match[1]);
	return propertyKey(properties);
}

/**
 * Tailwind keeps its canonicalization tables under private symbols in `storage`. Canonicalize one
 * token on a probe with a one-class list, then identify the tables by their contents.
 */
function findStorageKeys(system: DesignSystem): StorageKeys | null {
	const marker = "flex";
	const probe: DesignSystem = { ...system, storage: {}, getClassList: () => [[marker, { modifiers: [] }]] };
	// An arbitrary property is valid in every theme and reaches the precomputed lookup.
	const token = system.theme.prefix ? `${system.theme.prefix}:[display:flex]` : "[display:flex]";
	probe.canonicalizeCandidates([token], { rem: 16 });
	let precomputed: symbol | null = null;
	let signatures: symbol | null = null;
	let compare: symbol | null = null;
	for (const key of Object.getOwnPropertySymbols(probe.storage)) {
		const table = probe.storage[key];
		if (!(table instanceof Map)) continue;
		for (const inner of table.values()) {
			if (typeof inner === "function") compare = key;
			if (!(inner instanceof Map)) continue;
			for (const [name, value] of inner) {
				if (Array.isArray(value) && value.includes(marker)) precomputed = key;
				if (name === token && typeof value === "string" && value.startsWith(".x")) signatures = key;
			}
		}
	}
	return precomputed === null || signatures === null || compare === null ? null : { precomputed, signatures, compare };
}

/**
 * Make canonicalization cheap without changing its output. Tailwind precomputes a signature for
 * every class in the class list before its first lookup. Here, class spellings are grouped once by
 * declared property set; a lookup builds signatures only for the group its signature can match.
 * All other Tailwind tables stay shared by every token.
 */
export function optimizeDesignSystem(system: DesignSystem): DesignSystem {
	// `compileCandidates` reads the order only for variants of the compiled candidates, and most
	// canonicalization compiles have none. Sort the parsed variants only when one is read.
	const getVariantOrder = system.getVariantOrder.bind(system);
	system.getVariantOrder = () => {
		let order: Map<Variant, number> | null = null;
		return { get: (variant: Variant) => (order ??= getVariantOrder()).get(variant) } as Map<Variant, number>;
	};

	const keys = findStorageKeys(system);
	if (keys === null) return system;

	// Class spellings in Tailwind's precomputation order. `owners` packs (entry index << 1) | isModifier.
	const classList = system.getClassList();
	const spellings: Array<string> = [];
	const owners: Array<number> = [];
	const groupOfSpelling: Array<number> = [];
	const groupIds = new Map<string, number>();
	for (let entry = 0; entry < classList.length; entry++) {
		const [name, meta] = classList[entry];
		const names = [name];
		for (const modifier of meta.modifiers) if (!isComputedModifier(modifier)) names.push(`${name}/${modifier}`);
		for (let i = 0; i < names.length; i++) {
			const properties: Array<string> = [];
			try {
				for (const candidate of system.parseCandidate(system.theme.prefix ? `${system.theme.prefix}:${names[i]}` : names[i])) {
					compiledProperties(system, candidate, properties);
				}
			} catch { continue; }
			const key = propertyKey(properties);
			let group = groupIds.get(key);
			if (group === undefined) groupIds.set(key, group = groupIds.size);
			spellings.push(names[i]);
			owners.push((entry << 1) | (i === 0 ? 0 : 1));
			groupOfSpelling.push(group);
		}
	}
	// Compressed rows: group g holds spellingOrder[groupStart[g] .. groupStart[g + 1]), in list order.
	const groupCount = groupIds.size;
	const groupStart = new Uint32Array(groupCount + 1);
	for (const group of groupOfSpelling) groupStart[group + 1]++;
	for (let group = 0; group < groupCount; group++) groupStart[group + 1] += groupStart[group];
	const next = groupStart.slice(0, groupCount);
	const spellingOrder = new Uint32Array(spellings.length);
	for (let spelling = 0; spelling < spellings.length; spelling++) spellingOrder[next[groupOfSpelling[spelling]]++] = spelling;

	const signaturesFor = (options: object) => (system.storage[keys.signatures] as OptionsTable<SignatureTable>).get(options);

	// One signature index per signature options (root font size), each filled one group at a time.
	const indexes: Array<{ options: object; groups: Array<Map<string, Array<string>> | undefined> }> = [];
	const buildGroup = (signatures: SignatureTable, group: number) => {
		const bySignature = new Map<string, Array<string>>();
		for (let i = groupStart[group]; i < groupStart[group + 1]; i++) {
			const spelling = spellingOrder[i];
			const owner = owners[spelling];
			const className = classList[owner >>> 1][0];
			// Tailwind skips an entry, with its modifiers, when it has no signature or repeats its positive zero.
			const base = signatures.get(className);
			if (typeof base !== "string") continue;
			if (className[0] === "-" && className.endsWith("-0")) {
				const positive = signatures.get(className.slice(1));
				if (typeof positive === "string" && positive === base) continue;
			}
			const signature = (owner & 1) === 0 ? base : signatures.get(spellings[spelling]);
			if (typeof signature !== "string") continue;
			const list = bySignature.get(signature);
			if (list === undefined) bySignature.set(signature, [spellings[spelling]]);
			else list.push(spellings[spelling]);
		}
		return bySignature;
	};
	system.storage[keys.precomputed] = {
		get(options: object) {
			let index = indexes.find(candidate => candidate.options === options);
			if (index === undefined) indexes.push(index = { options, groups: Array.from({ length: groupCount }) });
			const { groups } = index;
			const signatures = signaturesFor(options);
			return {
				get(signature: string): ReadonlyArray<string> {
					const group = groupIds.get(signatureKey(signature));
					if (group === undefined) return EMPTY;
					const bySignature = groups[group] ??= buildGroup(signatures, group);
					return bySignature.get(signature) ?? EMPTY;
				},
			};
		},
	} satisfies OptionsTable<{ get(signature: string): ReadonlyArray<string> }>;

	// Tailwind's `hasSameSignature`, with one exact shortcut: equal signatures declare equal
	// properties, so a replacement that declares other properties is rejected before its signature
	// is built. Arbitrary values try every functional root, so most replacements stop here.
	system.storage[keys.compare] = {
		get(options: object) {
			const signatures = signaturesFor(options);
			return (a: Candidate | string, b: Candidate | string): boolean => {
				const left = signatures.get(typeof a === "string" ? a : system.printCandidate(a));
				if (typeof left !== "string") return false;
				if (typeof b !== "string") {
					const properties: Array<string> = [];
					try { compiledProperties(system, b, properties); } catch { return false; }
					if (propertyKey(properties) !== signatureKey(left)) return false;
				}
				const right = signatures.get(typeof b === "string" ? b : system.printCandidate(b));
				return typeof right === "string" && left === right;
			};
		},
	} satisfies OptionsTable<(a: Candidate | string, b: Candidate | string) => boolean>;
	return system;
}
