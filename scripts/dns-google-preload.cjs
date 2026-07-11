"use strict";

const dns = require("dns");

// Some routers fail to resolve Shopify's GCS upload host; use public DNS for dev CLI.
dns.setServers(["8.8.8.8", "8.8.4.4"]);
