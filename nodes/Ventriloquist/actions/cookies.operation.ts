import type {
	IExecuteFunctions,
	INodeExecutionData,
	IDataObject,
	INodeProperties,
} from "n8n-workflow";
import type { Cookie, CookieParam, Page } from "puppeteer-core";
import { SessionManager } from "../utils/sessionManager";
import { formatOperationLog } from "../utils/resultUtils";
import { getActivePage } from "../utils/sessionUtils";

type CookieOp = "get" | "set" | "delete";
type CookieTarget = "all" | "one";
type MatchBy = "name" | "nameAndDomain";

/**
 * Cookies operation description — UI fields shown when operation = 'cookies'
 *
 * Top-level shape:
 *   Cookie Operation: Get | Set | Delete
 *     - Get / Delete → Target: All | One
 *       - All  → optional Domain Filter + optional Name Allowlist
 *       - One  → Match By: Name | Name + Domain  (+ Cookie Name, +/- Match Domain)
 *     - Set → Cookies input (JSON array or header string) + Default Domain
 */
export const description: INodeProperties[] = [
	{
		displayName: "Session ID",
		name: "sessionId",
		type: "string",
		default: "",
		description:
			"Session ID to use (if not provided, will use sessionId from previous operations)",
		displayOptions: {
			show: {
				operation: ["cookies"],
			},
		},
	},
	{
		displayName: "Cookie Operation",
		name: "cookieOperation",
		type: "options",
		noDataExpression: true,
		options: [
			{
				name: "Get",
				value: "get",
				description:
					"Read cookies from the current session. Outputs both a cookies array and a pre-formatted sessionCookie header string ready to drop into an HTTP Cookie header.",
			},
			{
				name: "Set",
				value: "set",
				description:
					"Set one or more cookies (accepts an array of cookie objects or a Cookie header string)",
			},
			{
				name: "Delete",
				value: "delete",
				description:
					"Delete cookies from the current session (either all in scope, or a single specific cookie)",
			},
		],
		default: "get",
		description: "Which cookie operation to perform",
		displayOptions: {
			show: {
				operation: ["cookies"],
			},
		},
	},

	// Target — All vs One (Get and Delete only)
	{
		displayName: "Target",
		name: "cookieTarget",
		type: "options",
		noDataExpression: true,
		options: [
			{
				name: "All Cookies",
				value: "all",
				description:
					"Operate on every cookie in the session (optionally narrowed by Domain Filter or Name Allowlist below)",
			},
			{
				name: "One Specific Cookie",
				value: "one",
				description: "Operate on a single cookie matched by the rules below",
			},
		],
		default: "all",
		description: "Whether to operate on all cookies or a single specific cookie",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["get", "delete"],
			},
		},
	},

	// ===== Fields for Target = All =====

	{
		displayName: "Domain Filter",
		name: "domainFilter",
		type: "string",
		default: "",
		placeholder: ".cotthosting.com",
		description:
			"Optional domain substring filter. Cookies whose domain does not include this string are skipped. Leave blank to include all domains.",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["get", "delete"],
				cookieTarget: ["all"],
			},
		},
	},
	{
		displayName: "Cookie Names (Allowlist)",
		name: "cookieNames",
		type: "string",
		default: "",
		placeholder: "CottSqlAuthCookie, ASP.NET_SessionId",
		description:
			"Comma-separated list of cookie names to include. Leave blank to include all cookies.",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["get", "delete"],
				cookieTarget: ["all"],
			},
		},
	},

	// ===== Fields for Target = One =====

	{
		displayName: "Match By",
		name: "matchBy",
		type: "options",
		noDataExpression: true,
		options: [
			{
				name: "Name",
				value: "name",
				description:
					"Match the first cookie with this name. Use when you know the name and don't need to disambiguate between domains.",
			},
			{
				name: "Name + Domain",
				value: "nameAndDomain",
				description:
					"Match a cookie by both name AND domain. Use when multiple cookies share a name across domains and you need to pick the right one.",
			},
		],
		default: "name",
		description: "How to identify the single cookie to operate on",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["get", "delete"],
				cookieTarget: ["one"],
			},
		},
	},
	{
		displayName: "Cookie Name",
		name: "cookieName",
		type: "string",
		default: "",
		placeholder: "CottSqlAuthCookie",
		description: "Name of the cookie to match",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["get", "delete"],
				cookieTarget: ["one"],
			},
		},
	},
	{
		displayName: "Match Domain",
		name: "matchDomain",
		type: "string",
		default: "",
		placeholder: ".cotthosting.com",
		description:
			"Domain (or domain substring) the matched cookie must belong to",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["get", "delete"],
				cookieTarget: ["one"],
				matchBy: ["nameAndDomain"],
			},
		},
	},

	// ===== Fields for Set =====

	{
		displayName: "Cookies Input Format",
		name: "cookiesInputFormat",
		type: "options",
		options: [
			{
				name: "JSON Array",
				value: "array",
				description:
					"An array of cookie objects: [{name, value, domain, path?, expires?, httpOnly?, secure?, sameSite?}, ...]",
			},
			{
				name: "Header String",
				value: "headerString",
				description:
					"A Cookie HTTP header value: 'name1=val1; name2=val2; ...'. Requires a Default Domain so each parsed cookie can be attached to the browser session.",
			},
		],
		default: "array",
		description: "Format of the Cookies field below",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["set"],
			},
		},
	},
	{
		displayName: "Cookies",
		name: "cookiesInput",
		type: "string",
		typeOptions: {
			rows: 4,
		},
		default: "",
		placeholder:
			'[{"name":"CottSqlAuthCookie","value":"...","domain":".cotthosting.com"}]',
		description:
			"Cookies to set, in the format chosen above. JSON Array must parse to an array of cookie objects.",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["set"],
			},
		},
	},
	{
		displayName: "Default Domain",
		name: "defaultDomain",
		type: "string",
		default: "",
		placeholder: ".cotthosting.com",
		description:
			"Domain to attach to cookies that don't specify one (required when using Header String format)",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["set"],
			},
		},
	},

	// ===== Output toggle (all ops) =====
	{
		displayName: "Output Input Data",
		name: "outputInputData",
		type: "boolean",
		default: true,
		description:
			"Whether to merge input data from previous nodes into the output (useful for keeping the rest of the JSON intact alongside the cookies result)",
		displayOptions: {
			show: {
				operation: ["cookies"],
			},
		},
	},
];

/**
 * Format a cookies array as a Cookie HTTP header value: 'name1=val1; name2=val2; ...'
 */
function formatCookieHeader(cookies: Cookie[]): string {
	return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Apply optional filters (domain substring, name allowlist) to a cookies array.
 */
function filterCookies(
	cookies: Cookie[],
	domainFilter: string,
	nameAllowlist: string[],
): Cookie[] {
	let result = cookies;
	if (domainFilter) {
		const needle = domainFilter.toLowerCase();
		result = result.filter((c) =>
			(c.domain || "").toLowerCase().includes(needle),
		);
	}
	if (nameAllowlist.length > 0) {
		const allowed = new Set(nameAllowlist.map((n) => n.trim()).filter(Boolean));
		result = result.filter((c) => allowed.has(c.name));
	}
	return result;
}

/**
 * Find the single cookie a "Target = One" operation should act on.
 * Returns null if no match.
 */
function findOneCookie(
	cookies: Cookie[],
	cookieName: string,
	matchBy: MatchBy,
	matchDomain: string,
): Cookie | null {
	if (!cookieName) {
		throw new Error("Cookie Name is required when Target = 'One Specific Cookie'");
	}
	if (matchBy === "nameAndDomain") {
		if (!matchDomain) {
			throw new Error(
				"Match Domain is required when Match By = 'Name + Domain'",
			);
		}
		const needle = matchDomain.toLowerCase();
		return (
			cookies.find(
				(c) =>
					c.name === cookieName &&
					(c.domain || "").toLowerCase().includes(needle),
			) || null
		);
	}
	// matchBy === "name"
	return cookies.find((c) => c.name === cookieName) || null;
}

/**
 * Parse a Cookie header string ("name1=val1; name2=val2") into puppeteer-shaped cookie params.
 */
function parseHeaderString(
	header: string,
	defaultDomain: string,
): Array<{ name: string; value: string; domain: string }> {
	if (!defaultDomain) {
		throw new Error(
			"Default Domain is required when Cookies Input Format is 'Header String'",
		);
	}
	return header
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((pair) => {
			const eq = pair.indexOf("=");
			if (eq === -1) {
				throw new Error(`Malformed cookie pair (no '='): "${pair}"`);
			}
			const name = pair.slice(0, eq).trim();
			const value = pair.slice(eq + 1).trim();
			return { name, value, domain: defaultDomain };
		});
}

/**
 * Execute the cookies operation.
 */
export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const startTime = Date.now();
	const items = this.getInputData();
	const item = items[index];
	const logger = this.logger;
	const nodeName = this.getNode().name;
	const nodeId = this.getNode().id;

	const explicitSessionId = this.getNodeParameter(
		"sessionId",
		index,
		"",
	) as string;
	const cookieOperation = this.getNodeParameter(
		"cookieOperation",
		index,
		"get",
	) as CookieOp;
	const outputInputData = this.getNodeParameter(
		"outputInputData",
		index,
		true,
	) as boolean;

	logger.info(
		formatOperationLog(
			"Cookies",
			nodeName,
			nodeId,
			index,
			`Starting cookies operation: ${cookieOperation}`,
		),
	);

	// Resolve session
	const effectiveSessionId =
		explicitSessionId || ((item?.json?.sessionId as string) ?? "");
	if (!effectiveSessionId) {
		throw new Error("No session ID provided");
	}

	const session = SessionManager.getSession(effectiveSessionId);
	if (!session?.browser?.isConnected()) {
		throw new Error(
			`Invalid or disconnected browser session: ${effectiveSessionId}`,
		);
	}

	const page: Page | null = await getActivePage(
		session.browser,
		logger,
		effectiveSessionId,
	);
	if (!page) {
		throw new Error(
			`No active page found for session: ${effectiveSessionId}`,
		);
	}

	const baseJson: IDataObject =
		outputInputData && item?.json ? { ...item.json } : {};

	try {
		// ---------- GET ----------
		if (cookieOperation === "get") {
			const cookieTarget = this.getNodeParameter(
				"cookieTarget",
				index,
				"all",
			) as CookieTarget;
			const allCookies = await page.cookies();

			if (cookieTarget === "all") {
				const domainFilter = this.getNodeParameter(
					"domainFilter",
					index,
					"",
				) as string;
				const cookieNamesRaw = this.getNodeParameter(
					"cookieNames",
					index,
					"",
				) as string;
				const nameAllowlist = cookieNamesRaw
					? cookieNamesRaw.split(",").map((s) => s.trim()).filter(Boolean)
					: [];

				const filtered = filterCookies(
					allCookies,
					domainFilter,
					nameAllowlist,
				);
				const sessionCookie = formatCookieHeader(filtered);

				logger.info(
					formatOperationLog(
						"Cookies",
						nodeName,
						nodeId,
						index,
						`get all: ${allCookies.length} total, ${filtered.length} after filter`,
					),
				);

				return [
					{
						json: {
							...baseJson,
							sessionId: effectiveSessionId,
							success: true,
							operation: "cookies",
							cookieOperation: "get",
							cookieTarget: "all",
							cookies: filtered as unknown as IDataObject[],
							sessionCookie,
							cookieCount: filtered.length,
							totalCookieCount: allCookies.length,
							executionDuration: Date.now() - startTime,
						},
						pairedItem: { item: index },
					},
				];
			}

			// cookieTarget === "one"
			const cookieName = this.getNodeParameter(
				"cookieName",
				index,
				"",
			) as string;
			const matchBy = this.getNodeParameter(
				"matchBy",
				index,
				"name",
			) as MatchBy;
			const matchDomain = this.getNodeParameter(
				"matchDomain",
				index,
				"",
			) as string;

			const found = findOneCookie(
				allCookies,
				cookieName,
				matchBy,
				matchDomain,
			);

			return [
				{
					json: {
						...baseJson,
						sessionId: effectiveSessionId,
						success: true,
						operation: "cookies",
						cookieOperation: "get",
						cookieTarget: "one",
						matchBy,
						cookieName,
						cookie: found as unknown as IDataObject | null,
						found: found !== null,
						sessionCookie: found ? `${found.name}=${found.value}` : "",
						executionDuration: Date.now() - startTime,
					},
					pairedItem: { item: index },
				},
			];
		}

		// ---------- SET ----------
		if (cookieOperation === "set") {
			const format = this.getNodeParameter(
				"cookiesInputFormat",
				index,
				"array",
			) as "array" | "headerString";
			const cookiesInput = this.getNodeParameter(
				"cookiesInput",
				index,
				"",
			) as string;
			const defaultDomain = this.getNodeParameter(
				"defaultDomain",
				index,
				"",
			) as string;

			if (!cookiesInput) {
				throw new Error("Cookies field is required for the 'Set' operation");
			}

			let toSet: CookieParam[] = [];
			if (format === "array") {
				let parsed: unknown;
				try {
					parsed = JSON.parse(cookiesInput);
				} catch (err) {
					throw new Error(
						`Cookies field is not valid JSON: ${(err as Error).message}`,
					);
				}
				if (!Array.isArray(parsed)) {
					throw new Error("Cookies field must be a JSON array");
				}
				toSet = (parsed as IDataObject[]).map((c) => {
					if (!c.name || c.value === undefined) {
						throw new Error(
							"Each cookie must have at least { name, value }",
						);
					}
					const domain = (c.domain as string) || defaultDomain;
					if (!domain) {
						throw new Error(
							`Cookie "${c.name}" has no domain and no Default Domain was provided`,
						);
					}
					return {
						name: c.name as string,
						value: String(c.value),
						domain,
						path: (c.path as string) || "/",
						expires: c.expires as number | undefined,
						httpOnly: c.httpOnly as boolean | undefined,
						secure: c.secure as boolean | undefined,
						sameSite: c.sameSite as
							| "Strict"
							| "Lax"
							| "None"
							| undefined,
					};
				});
			} else {
				toSet = parseHeaderString(cookiesInput, defaultDomain).map((c) => ({
					name: c.name,
					value: c.value,
					domain: c.domain,
					path: "/",
				}));
			}

			if (toSet.length === 0) {
				throw new Error("No cookies parsed from input");
			}

			await page.setCookie(...toSet);

			logger.info(
				formatOperationLog(
					"Cookies",
					nodeName,
					nodeId,
					index,
					`set: ${toSet.length} cookie(s)`,
				),
			);

			return [
				{
					json: {
						...baseJson,
						sessionId: effectiveSessionId,
						success: true,
						operation: "cookies",
						cookieOperation: "set",
						cookiesSet: toSet.length,
						cookieNames: toSet.map((c) => c.name),
						executionDuration: Date.now() - startTime,
					},
					pairedItem: { item: index },
				},
			];
		}

		// ---------- DELETE ----------
		if (cookieOperation === "delete") {
			const cookieTarget = this.getNodeParameter(
				"cookieTarget",
				index,
				"all",
			) as CookieTarget;
			const allCookies = await page.cookies();
			let targets: Cookie[] = [];

			if (cookieTarget === "all") {
				const domainFilter = this.getNodeParameter(
					"domainFilter",
					index,
					"",
				) as string;
				const cookieNamesRaw = this.getNodeParameter(
					"cookieNames",
					index,
					"",
				) as string;
				const nameAllowlist = cookieNamesRaw
					? cookieNamesRaw.split(",").map((s) => s.trim()).filter(Boolean)
					: [];
				targets = filterCookies(allCookies, domainFilter, nameAllowlist);
			} else {
				const cookieName = this.getNodeParameter(
					"cookieName",
					index,
					"",
				) as string;
				const matchBy = this.getNodeParameter(
					"matchBy",
					index,
					"name",
				) as MatchBy;
				const matchDomain = this.getNodeParameter(
					"matchDomain",
					index,
					"",
				) as string;
				const found = findOneCookie(
					allCookies,
					cookieName,
					matchBy,
					matchDomain,
				);
				targets = found ? [found] : [];
			}

			for (const c of targets) {
				await page.deleteCookie({
					name: c.name,
					domain: c.domain,
					path: c.path,
				});
			}

			logger.info(
				formatOperationLog(
					"Cookies",
					nodeName,
					nodeId,
					index,
					`delete (${cookieTarget}): ${targets.length}/${allCookies.length} cookies deleted`,
				),
			);

			return [
				{
					json: {
						...baseJson,
						sessionId: effectiveSessionId,
						success: true,
						operation: "cookies",
						cookieOperation: "delete",
						cookieTarget,
						deletedCount: targets.length,
						totalCookieCount: allCookies.length,
						executionDuration: Date.now() - startTime,
					},
					pairedItem: { item: index },
				},
			];
		}

		throw new Error(`Unknown cookie operation: ${cookieOperation}`);
	} catch (error) {
		logger.error(
			formatOperationLog(
				"Cookies",
				nodeName,
				nodeId,
				index,
				`Cookies operation failed: ${(error as Error).message}`,
			),
		);
		if (this.continueOnFail()) {
			return [
				{
					json: {
						...baseJson,
						success: false,
						operation: "cookies",
						cookieOperation,
						error: (error as Error).message,
						executionDuration: Date.now() - startTime,
					},
					pairedItem: { item: index },
				},
			];
		}
		throw error;
	}
}
