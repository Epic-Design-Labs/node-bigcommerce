"use strict";

import https from "https";
import zlib from "zlib";
import { HTTPS_PROTOCOL } from "./constants";
import { handleConversionObjectToString, handleConversionStringToObject, handleConversionStringToUppercase } from "./utils/convertValues";

// Handle parsing the response from the BigCommerce API
function parseBodyResponse(res, body, resolve, reject, logger) {
	try {
		if (!/application\/json/.test(res.headers["content-type"]) || body.trim() === "") {
			logger.error("The response body from the BigCommerce API is not in JSON format.");

			return resolve(body);
		}

		// Convert string to object
		const { errors, error } = handleConversionStringToObject(body);

		// Check for errors in the body response, if there is found, reject the promise
		if (error || errors) {
			const err = new Error(error || handleConversionObjectToString(errors));

			return reject(err);
		}

		// Return the body response as a JSON object
		return resolve(handleConversionStringToObject(body));
	} catch (err) {
		err.responseBody = body;

		return reject(err);
	}
}

class Request {
	constructor(hostname, { headers = {}, logger = null } = {}) {
		if (!hostname) throw new Error("The hostname is required to make the call to the server.");

		this.hostname = hostname;
		this.headers = headers;
		this.logger = logger;
		this.protocol = HTTPS_PROTOCOL;
	}

	// Handle running plugin
	run(method, path, data = null) {
		const dataString = data ? handleConversionObjectToString(data) : null;

		const options = {
			path: path,
			protocol: this.protocol,
			hostname: this.hostname,
			port: 443,
			method: handleConversionStringToUppercase(method),
			gzip: true,
			headers: Object.assign(
				{
					"Content-Type": "application/json"
				},
				this.headers
			)
		};

		if (dataString) {
			options.headers["Content-Length"] = Buffer.from(dataString).length;
		}

		return new Promise((resolve, reject) => {
			const req = https.request(options, (res) => {
				// Send log message when requesting data
				this.logger.info(`${"[" + method.toUpperCase() + "] " + HTTPS_PROTOCOL + this.hostname + path}`);

				if (Math.round(res.statusCode / 100) === 2) {
					this.logger.debug(`${res.statusCode + " " + res.statusMessage}`);
				} else if (Math.round(res.statusCode / 100) === 4 || Math.round(res.statusCode / 100) === 5) {
					this.logger.error(`${res.statusCode + " " + res.statusMessage}`);
				} else {
					this.logger.debug(`${res.statusCode + " " + res.statusMessage}`);
				}

				let body = "";

				// Handle API rate limit
				const statusCode = res.statusCode;

				if (Math.round(statusCode / 100) === 4) {
					if (statusCode === 429) {
						const xRetryAfterHeader = res.headers["x-retry-after"];

						if (xRetryAfterHeader) {
							this.logger.error(`The BigCommerce API rate limit has been reached. Please wait ${xRetryAfterHeader} seconds before making another request.`);
						}

						return setTimeout(() => {
							// Send log message when restarting request
							this.logger.info("Restarting request...");

							// Send log message when restarting request
							this.logger.info(`${"[" + method.toUpperCase() + "] " + HTTPS_PROTOCOL + this.hostname + path}`);

							this.run(method, path, data).then(resolve).catch(reject);
						}, xRetryAfterHeader * 1000);
					}
				}

				// Append the response body to the body variable
				res.on("data", (chunk) => (body += chunk));

				// End BigCommerce response execution
				res.on("end", () => {
					if (statusCode >= 400 && statusCode <= 600) {
						const errMessage = new Error(`BigCommerce API request failed with status code ${statusCode}.`);
						errMessage.statusCode = statusCode;
						errMessage.body = body;

						return reject(errMessage);
					}

					// Calling gzip method
					return zlib.gzip(body, (err, data) => {
						if (err) {
							return reject(err);
						}

						// Calling gunzip method
						zlib.gunzip(data, (err, data) => {
							if (err) {
								return reject(err);
							}

							return parseBodyResponse(res, data.toString("utf8"), resolve, reject, this.logger);
						});
					});
				});
			});

			if (dataString) {
				// Send log message when sending data
				this.logger.info("Sending BigCommerce data...");

				// Send log message when requesting data
				this.logger.info(`${"[" + method.toUpperCase() + "] " + HTTPS_PROTOCOL + this.hostname + path}`);

				req.write(dataString);

				this.logger.info("Sending complete.");
			}

			// Handle BigCommerce API request errors
			req.on("error", (err) => reject(err));

			// End BigCommerce request execution
			req.end();
		});
	}
}

export default Request;
