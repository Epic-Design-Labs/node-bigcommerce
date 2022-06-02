/* eslint-disable no-unused-vars */
"use strict";

/**
 * BigCommerce OAuth2 Authentication and API access
 *
 * @param {Object} config
 * @return null
 */

import crypto from "crypto";
import logger from "debug";
import { REQUEST_BIGCOMMERCE_API_URL, REQUEST_BIGCOMMERCE_LOGIN_URL, REQUEST_BIGCOMMERCE_OAUTH_TOKEN_ENDPOINT } from "./constants";
import Request from "./request";
import { handleConversionStringToLowercase, handleConversionStringToObject } from "./utils/convertValues";

class BigCommerce {
	constructor(config) {
		if (!config) {
			const errMessage = "The library requires a config object to be passed in to make any API calls. Please see the documentation for more information.";

			throw new Error(errMessage);
		} else {
			const { siteUrl = null, clientId = null, secret = null, accessToken = null, storeHash = null, headers = {}, callback = null, logLevel = "info", responseType = "json", agent = null } = config;

			if (!siteUrl) {
				throw new Error("The library requires a `siteUrl` to be passed in to make any API calls. Please see the documentation for more information.");
			}

			if (!clientId) {
				throw new Error("The library requires a `clientId` to be passed in to make any API calls. Please see the documentation for more information.");
			}

			if (!secret) {
				throw new Error("The library requires a `secret` to be passed in to make any API calls. Please see the documentation for more information.");
			}

			if (!accessToken) {
				throw new Error("The library requires an `accessToken` to be passed in to make any API calls. Please see the documentation for more information.");
			}

			if (!storeHash) {
				throw new Error("The library requires a `storeHash` to be passed in to make any API calls. Please see the documentation for more information.");
			}

			if (!callback) {
				throw new Error("The library requires a `callback` to be passed in to make any API calls. Please see the documentation for more information.");
			}

			this.config = {
				siteUrl: handleConversionStringToLowercase(siteUrl),
				clientId: handleConversionStringToLowercase(clientId),
				secret: handleConversionStringToLowercase(secret),
				accessToken: handleConversionStringToLowercase(accessToken),
				storeHash: handleConversionStringToLowercase(storeHash),
				headers: handleConversionStringToObject(headers),
				callback: handleConversionStringToLowercase(callback),
				logLevel: handleConversionStringToLowercase(logLevel),
				responseType: handleConversionStringToLowercase(responseType),
				agent
			};
			this.grantType = "authorization_code";
			this.logger = logger("node-bigcommerce");
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
				this.config.headers
			),
			agent: this.config.agent,
			logger: this.logger
		});
	}

	// Handle verify signed request
	async verify(signedRequest) {
		if (!signedRequest) {
			throw new Error("The signed request is required to verify the call.");
		}

		const splitRequest = signedRequest.split(".");

		if (splitRequest.length < 2) {
			throw new Error("The signed request will come in two parts seperated by a .(full stop). " + "this signed request contains less than 2 parts.");
		}

		const signature = Buffer.from(splitRequest[1], "base64").toString("utf8");
		const json = Buffer.from(splitRequest[0], "base64").toString("utf8");
		const data = handleConversionStringToObject(json);
		const expected = crypto.createHmac("sha256", this.config.secret).update(json).digest("hex");

		this.logger("JSON: " + json);
		this.logger("Signature: " + signature);
		this.logger("Expected Signature: " + expected);

		// If the expected length of signature doesn't match the current signature length, throw an error, otherwise return data
		if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"))) {
			throw new Error("Signature is invalid");
		}

		this.logger("Signature is valid.");

		return data;
	}

	// Handle authentication request
	async authorize(query) {
		if (!query) throw new Error("The URL query paramaters are required.");

		// Query props
		const { code, scope, context } = await query;

		// Init payload
		const payload = {
			client_id: this.config.clientId,
			client_secret: this.config.secret,
			redirect_uri: this.config.callback,
			grant_type: this.grantType,
			code: code,
			scope: scope,
			context: context
		};

		// Run request
		const request = this.createAPIRequest(REQUEST_BIGCOMMERCE_LOGIN_URL);
		const oAuthToken = REQUEST_BIGCOMMERCE_OAUTH_TOKEN_ENDPOINT;

		return await request.run("post", oAuthToken, payload);
	}

	// Handle API requests
	async request(type, path, data = null) {
		// If current `config` have null `accessToken` or null `storeHash`, throw an error
		if (!this.config.accessToken == null || !this.config.storeHash == null) {
			throw new Error("Both the access token and store hash are required to make BigCommerce API requests.");
		}

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

	// Handle `GET` request
	async get(path) {
		return await this.request("get", path);
	}

	// Handle `POST` request
	async post(path, data) {
		return await this.request("post", path, data);
	}

	// Handle `PUT` request
	async put(path, data) {
		return await this.request("put", path, data);
	}

	// Handle `DELETE` request
	async delete(path) {
		return await this.request("delete", path);
	}
}

export default BigCommerce;
