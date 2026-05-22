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

type CookieOp = "getAll" | "get" | "set" | "delete" | "clear";

/**
 * Cookies operation description — UI fields shown when operation = 'cookies'
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
				name: "Get All",
				value: "getAll",
				description:
					"Read all cookies from the current page. Outputs both a cookies array and a pre-formatted sessionCookie header string ready to drop into an HTTP Cookie header.",
			},
			{
				name: "Get One",
				value: "get",
				description: "Read a single cookie by name",
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
				description: "Delete a single cookie by name",
			},
			{
				name: "Clear",
				value: "clear",
				description:
					"Clear all cookies in the session (optionally restricted by domain or name allowlist)",
			},
		],
		default: "getAll",
		description: "Which cookie operation to perform",
		displayOptions: {
			show: {
				operation: ["cookies"],
			},
		},
	},

	// Cookie Name — for Get One and Delete
	{
		displayName: "Cookie Name",
		name: "cookieName",
		type: "string",
		default: "",
		placeholder: "CottSqlAuthCookie",
		description: "Name of the cookie to operate on",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["get", "delete"],
			},
		},
	},

	// Domain Filter — for Get All, Clear, and Delete (optional)
	{
		displayName: "Domain Filter",
		name: "domainFilter",
		type: "string",
		default: "",
		placeholder: ".cotthosting.com",
		description:
			"Optional domain to restrict the operation to. Cookies whose domain does not match (substring) are skipped. Leave blank for all domains.",
		displayOptions: {
			show: {
				operation: ["cookies"],
				cookieOperation: ["getAll", "clear", "delete"],
			},
		},
	},

	// Name Allowlist — for Get All and Clear
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
				cookieOperation: ["getAll", "clear"],
			},
		},
	},

	// Cookies Input — for Set
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
		"getAll",
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
		if (cookieOperation === "getAll") {
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

			const allCookies = await page.cookies();
			const filtered = filterCookies(allCookies, domainFilter, nameAllowlist);
			const sessionCookie = formatCookieHeader(filtered);

			logger.info(
				formatOperationLog(
					"Cookies",
					nodeName,
					nodeId,
					index,
					`getAll: ${allCookies.length} total, ${filtered.length} after filter`,
				),
			);

			return [
				{
					json: {
						...baseJson,
						sessionId: effectiveSessionId,
						success: true,
						operation: "cookies",
						cookieOperation: "getAll",
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

		if (cookieOperation === "get") {
			const cookieName = this.getNodeParameter(
				"cookieName",
				index,
				"",
			) as string;
			if (!cookieName) {
				throw new Error("Cookie Name is required for the 'Get One' operation");
			}

			const allCookies = await page.cookies();
			const found = allCookies.find((c) => c.name === cookieName) || null;

			return [
				{
					json: {
						...baseJson,
						sessionId: effectiveSessionId,
						success: true,
						operation: "cookies",
						cookieOperation: "get",
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

		if (cookieOperation === "delete") {
			const cookieName = this.getNodeParameter(
				"cookieName",
				index,
				"",
			) as string;
			const domainFilter = this.getNodeParameter(
				"domainFilter",
				index,
				"",
			) as string;
			if (!cookieName) {
				throw new Error("Cookie Name is required for the 'Delete' operation");
			}

			const allCookies = await page.cookies();
			const targets = allCookies.filter((c) => {
				if (c.name !== cookieName) return false;
				if (
					domainFilter &&
					!(c.domain || "").toLowerCase().includes(domainFilter.toLowerCase())
				) {
					return false;
				}
				return true;
			});

			for (const c of targets) {
				await page.deleteCookie({
					name: c.name,
					domain: c.domain,
					path: c.path,
				});
			}

			return [
				{
					json: {
						...baseJson,
						sessionId: effectiveSessionId,
						success: true,
						operation: "cookies",
						cookieOperation: "delete",
						cookieName,
						deletedCount: targets.length,
						executionDuration: Date.now() - startTime,
					},
					pairedItem: { item: index },
				},
			];
		}

		if (cookieOperation === "clear") {
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

			const allCookies = await page.cookies();
			const targets = filterCookies(allCookies, domainFilter, nameAllowlist);

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
					`clear: ${targets.length}/${allCookies.length} cookies deleted`,
				),
			);

			return [
				{
					json: {
						...baseJson,
						sessionId: effectiveSessionId,
						success: true,
						operation: "cookies",
						cookieOperation: "clear",
						clearedCount: targets.length,
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
