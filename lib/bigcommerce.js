/* eslint-disable no-unused-vars */
"use strict";

/**
 * BigCommerce OAuth2 Authentication and API access
 *
 * @param {Object} config
 * @return null
 */

import crypto from "crypto";
import debug from "debug";
import { REQUEST_BIGCOMMERCE_API_URL } from "./constants";
import Request from "./request";
const logger = debug("node-bigcommerce:bigcommerce");

class BigCommerce {
	constructor(config) {
		if (!config) {
			const errMessage = "The library requires a config object to be passed in to make any API calls. Please see the documentation for more information.";

			throw new Error(errMessage);
		} else {
			const { siteUrl = undefined, clientId = undefined, secret = undefined, accessToken = undefined, storeHash = undefined, headers = undefined, callback = undefined } = config;

			if (!siteUrl) {
				const errMessage = "The library requires a `siteUrl` to be passed in to make any API calls. Please see the documentation for more information.";

				throw new Error(errMessage);
			}

			if (!clientId) {
				const errMessage = "The library requires a `clientId` to be passed in to make any API calls. Please see the documentation for more information.";

				throw new Error(errMessage);
			}

			if (!secret) {
				const errMessage = "The library requires a `secret` to be passed in to make any API calls. Please see the documentation for more information.";

				throw new Error(errMessage);
			}

			if (!accessToken) {
				const errMessage = "The library requires an `accessToken` to be passed in to make any API calls. Please see the documentation for more information.";

				throw new Error(errMessage);
			}

			if (!storeHash) {
				const errMessage = "The library requires a `storeHash` to be passed in to make any API calls. Please see the documentation for more information.";

				throw new Error(errMessage);
			}

			if (!callback) {
				const errMessage = "The library requires a `callback` to be passed in to make any API calls. Please see the documentation for more information.";

				throw new Error(errMessage);
			}

			this.config = config;
			this.grantType = "authorization_code";
		}
	}

	// Handle creating API request
	createAPIRequest(endpoint) {
		const accept = this.config.responseType === "xml" ? "application/xml" : "application/json";

		return new Request(endpoint, {
			headers: Object.assign(
				{
					"Accept": accept,
					"Content-Type": accept,
					"X-Auth-Client": this.config.clientId,
					"X-Auth-Token": this.config.accessToken
				},
				this.config.headers || {}
			),
			failOnLimitReached: this.config.failOnLimitReached,
			logger: this.config.logger,
			agent: this.config.agent
		});
	}

	verify(signedRequest) {
		if (!signedRequest) {
			throw new Error("The signed request is required to verify the call.");
		}

		const splitRequest = signedRequest.split(".");
		if (splitRequest.length < 2) {
			throw new Error("The signed request will come in two parts seperated by a .(full stop). " + "this signed request contains less than 2 parts.");
		}

		const signature = Buffer.from(splitRequest[1], "base64").toString("utf8");
		const json = Buffer.from(splitRequest[0], "base64").toString("utf8");
		const data = JSON.parse(json);

		logger("JSON: " + json);
		logger("Signature: " + signature);

		const expected = crypto.createHmac("sha256", this.config.secret).update(json).digest("hex");

		logger("Expected Signature: " + expected);

		if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"))) {
			throw new Error("Signature is invalid");
		}

		logger("Signature is valid");
		return data;
	}

	async authorize(query) {
		if (!query) throw new Error("The URL query paramaters are required.");

		const payload = {
			client_id: this.config.clientId,
			client_secret: this.config.secret,
			redirect_uri: this.config.callback,
			grant_type: "authorization_code",
			code: query.code,
			scope: query.scope,
			context: query.context
		};

		const request = new Request("login.bigcommerce.com", {
			failOnLimitReached: this.config.failOnLimitReached
		});

		return await request.run("post", "/oauth2/token", payload);
	}

	// Handle API requests
	async request(type, path, data = null) {
		// If current `config` have undefined `accessToken` or undefined `storeHash`, throw an error
		!this.config.accessToken == null || !this.config.storeHash == null
			? (() => {
					const errMessage = "Both the access token and store hash are required to make BigCommerce API requests.";

					throw new Error(errMessage);
			  })()
			: null;

		// Prepare `path` for request execution
		const extension = this.config.responseType === "xml" ? ".xml" : "";
		const request = this.createAPIRequest(REQUEST_BIGCOMMERCE_API_URL);
		const version = !path.includes("v3") ? path.replace(/(\?|$)/, extension + "$1") : path;

		// Update full path
		let fullPath = `/stores/${this.config.storeHash}`;

		fullPath += version;

		const response = await request.run(type, fullPath, data);

		// If response contains pagination.
		if ("meta" in response && "pagination" in response.meta) {
			const { total_pages: totalPages, current_page: currentPage } = response.meta.pagination;

			// If current page is not the last page.
			if (totalPages > currentPage) {
				// Collect all page request promises in array.
				const promises = [];

				for (let nextPage = currentPage + 1; nextPage <= totalPages; nextPage++) {
					const endpointUrl = new URL(fullPath, `https://${request.hostname}`);

					// Safely assign `page` query parameter to endpoint URL.
					endpointUrl.searchParams.set("page", nextPage);

					// Add promise to array for future Promise.All() call.
					promises.push(request.run(type, `${endpointUrl.pathname}${endpointUrl.search}`, data));
				}

				// Request all endpoints in parallel.
				const responses = await Promise.all(promises);

				responses.forEach((pageResponse) => {
					response.data = response.data.concat(pageResponse.data);
				});

				// Set pager to last page.
				response.meta.pagination.total_pages = totalPages;
				response.meta.pagination.current_page = totalPages;
			}
		}

		// Run request
		return response;
	}

	async get(path) {
		return await this.request("get", path);
	}

	async post(path, data) {
		return await this.request("post", path, data);
	}

	async put(path, data) {
		return await this.request("put", path, data);
	}

	async delete(path) {
		return await this.request("delete", path);
	}
}

export default BigCommerce;
