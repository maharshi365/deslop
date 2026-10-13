import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noRepeatedExpectCallRule } from "../src/rules/no-repeated-expect-call.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
	languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "repeatedCall" };

tester.run("no-repeated-expect-call", noRepeatedExpectCallRule, {
	valid: [
		{
			name: "array holes are not trailing commas",
			code: `expect(parse([,])).toHaveLength(1); expect(parse([])).toHaveLength(0);`,
		},
		{
			name: "a hole after an array element is significant",
			code: `expect(parse([value,,])).toHaveLength(2); expect(parse([value,])).toHaveLength(1);`,
		},
		{
			name: "does not lint application code",
			filename: "/repo/session.ts",
			code: `expect(readSession(auth)).toBeDefined(); expect(readSession(auth)).toMatchObject({ user });`,
		},
		{
			name: "storage download reuses one promise",
			code: `
				const download = presignSessionDownload(run, 'org', 'sessions', 'dev');
				expect(download).rejects.toThrow(AppError);
				expect(download).rejects.toMatchObject({ problem: { code: 'not_found' } });
			`,
		},
		{
			name: "Vercel recovery checks one promise",
			code: `
				const recovery = controller.recover(connection, allocation, 'run');
				expect(recovery).rejects.toThrow(RunFailure);
				expect(recovery).rejects.toMatchObject({ phase: 'cleanup', problem: { code } });
				expect(recovery).rejects.toHaveProperty('cause', failure);
			`,
		},
		{
			name: "SQS validation uses different inputs",
			code: `
				expect(publisher.publishBatch([])).rejects.toThrow('between 1 and 10');
				expect(publisher.publishBatch(Array.from({ length: 11 }, () => 'message'))).rejects.toThrow('between 1 and 10');
			`,
		},
		{
			name: "plan lookups in separate tests",
			code: `
				test('missing plan', () => {
					expect(readOrganizationPlan(database, organizationId, userId)).rejects.toThrow(AppError);
				});
				test('missing membership', () => {
					expect(readOrganizationPlan(database, organizationId, userId)).rejects.toThrow(AppError);
				});
			`,
		},
		{
			name: "intervening state changes permit repeated calls",
			code: `expect(readSession(auth)).toBeNull(); auth.session = session; expect(readSession(auth)).toEqual(session);`,
		},
		{
			name: "an intervening assertion breaks adjacency",
			code: `expect(readSession(auth)).toBeNull(); expect(auth.calls).toBe(1); expect(readSession(auth)).toBeNull();`,
		},
		{
			name: "string whitespace is significant",
			code: `expect(isEmailAllowed(' alice@example.com')).toBe(true); expect(isEmailAllowed('alice@example.com')).toBe(true);`,
		},
		{
			name: "a local expect is not an assertion",
			code: `function check(expect) { expect(readSession(auth)).toBeNull(); expect(readSession(auth)).toBeNull(); }`,
		},
		{
			name: "expect from an unrelated module is not an assertion",
			code: `import { expect } from 'other'; expect(readSession(auth)).toBeNull(); expect(readSession(auth)).toBeNull();`,
		},
	].map((test) => ({ filename: "/repo/session.test.ts", ...test })),
	invalid: [
		{
			name: "CLI account import serializes the same output twice",
			code: `expect(JSON.stringify(f.output)).not.toContain('private-refresh'); expect(JSON.stringify(f.output)).not.toContain(access);`,
			errors: [error],
		},
		{
			name: "Docker cleanup maps the same command list twice",
			code: `expect(cli.calls.map(({ args }) => args[0])).toContain('stop'); expect(cli.calls.map(({ args }) => args[0])).not.toContain('rm');`,
			errors: [error],
		},
		{
			name: "runtime failure formats the same diagnostic twice",
			code: `expect(diagnosticText(failure)).toContain('status persistence failed: [REDACTED]'); expect(diagnosticText(failure)).not.toMatch(/read-token|write-token|model-secret/);`,
			errors: [error],
		},
		{
			name: "device sessions repeats the unauthorized request",
			code: `
				import { expect, test } from 'bun:test';
				test('rejects missing sessions', () => {
					expect(readDeviceSessions(auth, new Headers())).rejects.toThrow(AppError);
					expect(readDeviceSessions(auth, new Headers())).rejects.toMatchObject({
						problem: { code: 'permission_denied', message: 'Unauthorized' },
					});
				});
			`,
			errors: [{ ...error, line: 5 }],
		},
		{
			name: "awaited assertions still repeat the operation",
			code: `async function check() {
				await expect(readDeviceSessions(auth, headers)).rejects.toThrow(AppError);
				await expect(readDeviceSessions(auth, headers)).rejects.toMatchObject({ problem });
			}`,
			errors: [error],
		},
		{
			name: "synchronous calls with different matchers",
			code: `expect(serializeProblem(error)).toHaveProperty('code'); expect(serializeProblem(error)).toMatchObject({ message: 'Unauthorized' });`,
			errors: [error],
		},
		{
			name: "await inside expect and insignificant formatting",
			code: `async function check() {
				expect(await readSession(auth, headers)).toBeDefined();
				expect(await readSession(auth, /* same input */ headers,)).toMatchObject({ user });
			}`,
			errors: [error],
		},
		{
			name: "each later assertion in a chain is reported",
			code: `expect(readSession(auth)).toBeDefined(); expect(readSession(auth)).not.toBeNull(); expect(readSession(auth)).toMatchObject({ user });`,
			errors: [error, error],
		},
		{
			name: "an imported expect alias is recognized",
			code: `import { expect as check } from 'bun:test'; check(readSession(auth)).toBeDefined(); check(readSession(auth)).toMatchObject({ user });`,
			errors: [error],
		},
		{
			name: "Jest imports in a tests directory",
			filename: "/repo/tests/session.ts",
			code: `import { expect } from '@jest/globals'; expect(readSession(auth)).toBeDefined(); expect(readSession(auth)).toMatchObject({ user });`,
			errors: [error],
		},
		{
			name: "Vitest imports in a spec file",
			filename: "/repo/session.spec.ts",
			code: `import { expect } from 'vitest'; expect(readSession(auth)).toBeDefined(); expect(readSession(auth)).toMatchObject({ user });`,
			errors: [error],
		},
	].map((test) => ({ filename: "/repo/session.test.ts", ...test })),
});
