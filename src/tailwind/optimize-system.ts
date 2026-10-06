import type { __unstable__loadDesignSystem } from "@tailwindcss/node";

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;
type Candidate = ReturnType<DesignSystem["parseCandidate"]>[number];
type AstNode = ReturnType<DesignSystem["compileAstNodes"]>[number]["node"];
type ClassEntry = ReturnType<DesignSystem["getClassList"]>[number];

interface Utility {
	kind: string;
	options?: { types?: Array<string> };
	compileFn(candidate: Candidate): Array<AstNode> | null | undefined;
}

function propertyKey(system: DesignSystem, candidates: ReadonlyArray<Candidate>, raw = false): string {
	const properties = new Set<string>();
	function visit(node: AstNode) {
		if (node.kind === "at-rule" && node.name === "@property") return;
		if (node.kind === "declaration" && node.value !== undefined && !node.property.startsWith("--tw-")) properties.add(node.property);
		if ("nodes" in node) for (const child of node.nodes) visit(child);
	}
	for (const candidate of candidates) {
		if (!raw || candidate.kind === "arbitrary") {
			for (const { node } of system.compileAstNodes({ ...candidate, variants: [], important: false })) visit(node);
			continue;
		}
		// Property discovery needs utility declarations, not selector generation,
		// importance propagation, or Tailwind's expensive declaration sort order.
		const utilities: Array<Utility> = system.utilities.get(candidate.root) ?? [];
		const isFallback = (utility: Utility) => (utility.options?.types?.length ?? 0) > 1 && utility.options!.types!.includes("any");
		for (const fallback of [false, true]) {
			let accepted = false;
			for (const utility of utilities) {
				if (utility.kind !== candidate.kind || isFallback(utility) !== fallback) continue;
				const nodes = utility.compileFn(candidate);
				if (nodes === null && utility.options?.types?.length) { accepted = true; break; }
				if (nodes === null || nodes === undefined) continue;
				accepted = true;
				for (const node of nodes) visit(node);
			}
			if (accepted) break;
		}
	}
	return [...properties].sort().join("\0");
}

// Canonicalization only compares equivalent declaration sets. Partition its
// eager class index without changing the compiler, theme, or candidate parser.
export function optimizeDesignSystem(system: DesignSystem): DesignSystem {
	const parseVariant = system.parseVariant.bind(system);
	const getVariantOrder = system.getVariantOrder.bind(system);
	const seenVariants = new Set<NonNullable<ReturnType<DesignSystem["parseVariant"]>>>();
	let variantVersion = 0;
	let orderVersion = -1;
	let order: ReturnType<DesignSystem["getVariantOrder"]>;
	system.parseVariant = raw => {
		const variant = parseVariant(raw);
		if (variant !== null && !seenVariants.has(variant)) {
			seenVariants.add(variant);
			variantVersion++;
		}
		return variant;
	};
	system.getVariantOrder = () => {
		if (orderVersion !== variantVersion) {
			order = getVariantOrder();
			for (const variant of order.keys()) seenVariants.add(variant);
			orderVersion = variantVersion;
		}
		return order;
	};

	let groups: Map<string, Set<ClassEntry>> | undefined;
	const scopedSystems = new Map<string, DesignSystem>();
	function getGroups() {
		if (groups) return groups;
		const built = new Map<string, Set<ClassEntry>>();
		for (const entry of system.getClassList()) {
			// Match Tailwind's index: quarter-step numeric modifiers use its
			// on-demand fallback rather than the enumerated class signatures.
			const modifiers = entry[1].modifiers.filter((modifier: string) => {
				const number = Number(modifier);
				return !(number >= 0 && number % 0.25 === 0 && String(number) === modifier);
			});
			const spellings = [entry[0], ...modifiers.map((modifier: string) => `${entry[0]}/${modifier}`)];
			for (const spelling of spellings) {
				let key: string;
				const token = system.theme.prefix ? `${system.theme.prefix}:${spelling}` : spelling;
				try { key = propertyKey(system, system.parseCandidate(token), true); } catch { continue; }
				let group = built.get(key);
				if (!group) built.set(key, group = new Set());
				group.add(entry);
			}
		}
		return groups = built;
	}

	return {
		...system,
		canonicalizeCandidates(tokens, options) {
			return tokens.map(token => {
				const candidates = system.parseCandidate(token);
				if (candidates.every(candidate => candidate.kind === "static")) return system.canonicalizeCandidates([token], options)[0] ?? token;
				const keys = new Set([propertyKey(system, candidates)]);
				const withoutModifiers = candidates.map(candidate => candidate.kind === "static" ? candidate : { ...candidate, modifier: null });
				keys.add(propertyKey(system, withoutModifiers));
				const scopeKey = [...keys].sort().join("\x01");
				let scoped = scopedSystems.get(scopeKey);
				if (!scoped) {
					const entries = new Set<ClassEntry>();
					const index = getGroups();
					for (const key of keys) for (const entry of index.get(key) ?? []) entries.add(entry);
					const list = [...entries];
					scoped = { ...system, storage: {}, getClassList: () => list };
					scopedSystems.set(scopeKey, scoped);
				}
				return scoped.canonicalizeCandidates([token], options)[0] ?? token;
			});
		},
	};
}
