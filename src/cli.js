#!/usr/bin/env node

"use strict";
var path = require("path");
var process = require("process");

function usage() {
    var packageData = require(path.join(__dirname, "..", "package.json"));
    process.stdout.write("node-feed-aggregator, version " + packageData.version +
        "\n");
    process.stdout.write("\n");
    process.stdout.write(
        "Usage: node-feed-aggregator -c <config file> [-o <output file>] [-h]\n"
    );
    process.stdout.write("\t-c: (mandatory) path to configuration file\n");
    process.stdout.write(
        "\t-o: (optional) path to output file default is to output to stdout\n"
    );
    process.stdout.write("\t-h: (optional) display this help and exit\n");
    process.stdout.write("\n");
    process.stdout.write("Author: " + packageData.author + "\n");
    process.stdout.write("Homepage: " + packageData.homepage + "\n");
    process.stdout.write("License: " + packageData.license + "\n");
}

function error(e) {
    process.stderr.write(e.toString() + "\n");
    process.exit(1);
}

try {
    var argv = require("minimist")(process.argv.slice(2));
    if (typeof(argv.h) !== "undefined") {
        usage();
        process.exit(0);
    }
    var configPath = argv.c;
    var outputPath = argv.o;
    var fs = require("fs");
    var Error = require("@petitchevalroux/error");

    var Rss = require("rss");
    var stream = require("stream");
    var AggregatorStream = require(path.join(__dirname, "aggregator"));
    if (!configPath) {
        usage();
        throw new Error("missing configuration file");
    }
    var config = require(fs.realpathSync(configPath));
    var feeds = config.feeds;
    delete config.feeds;
    var rss = new Rss(config);
    var inputStream = new stream.Readable();
    var aggregatorStream = new AggregatorStream();
    var outStream = new stream.Writable({
        "objectMode": true,
        "write": function(item, encoding, cb) {
            rss.item({
                "title": item.title,
                "description": item.description,
                "url": item.url,
                "guid": item.guid ? item.guid : item.url,
                "date": item.pubdate ? item.pubdate : (item
                    .pubDate ? item.pubDate : item.date
                ),
                "categories": item.categories ? item.categories :
                    [],
                "author": item.author ? item.author : ""
            });
            cb();
        }
    });
    // Error handling
    aggregatorStream.on("error", function(err) {
        error(err);
    });
    outStream.on("error", function(err) {
        error(err);
    });
    inputStream.on("error", function(err) {
        error(err);
    });
    // When everything is ok
    outStream.on("finish", function() {
        var content = rss.xml();
        if (typeof(outputPath) === "string") {
            fs.writeFileSync(outputPath, content);
            process.stdout.write(outputPath + " created\n");
        } else {
            process.stdout.write(content);
        }
    });
    // Connect streams
    inputStream
        .pipe(aggregatorStream)
        .pipe(outStream);
    // Push feed's url to input
    feeds.forEach(function(feedUrl) {
        inputStream.push(feedUrl);
    });
    // End input
    inputStream.push(null);
} catch (err) {
    error(err);
}
