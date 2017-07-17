"use strict";
var stream = require("stream");
var util = require("util");
var Duplex = stream.Duplex;
var Promise = require("bluebird");
var Error = require("@petitchevalroux/error");
var sort = require("sort-stream");

function AggregatorStream(options) {
    if (!(this instanceof AggregatorStream)) {
        return new AggregatorStream(options);
    }
    options = options || {};
    this.concurrency = options.concurrency ? options.concurrency : 2;
    this.FeedParser = require("feedparser");
    this.request = require("request");
    this.async = require("async");
    this.sortingItems = 0;
    this.sortStream = sort(function(a, b) {
        try {
            if (a.pubDate > b.pubDate) {
                return -1;
            } else if (a.pubDate < b.pubDate) {
                return 1;
            }
        } catch (err) {
            return 0;
        }
        return 0;
    });
    delete options.concurrency;
    options.readableObjectMode = true;
    Duplex.call(this, options);
    var self = this;
    self.queue = self.async.queue(
        function(feed, callback) {
            self.parse(feed)
                .then(function() {
                    self.processingFeeds--;
                    callback();
                    return;
                })
                .catch(function(err) {
                    self.processingFeeds--;
                    self.emit("error", new Error(
                        "Error parsing feed: %s",
                        feed, err));
                    callback(err);
                });
        },
        self.concurrency
    );
    this.unsortedItems = [];
    this.sortedItems = [];
    this.processingFeeds = 0;
    this.inStream = new stream.Readable({
        "objectMode": true,
        read: function() {
            if (self.unsortedItems.length === 0) {
                if (self.processingFeeds) {
                    var stream = this;
                    setImmediate(function() {
                        stream._read();
                    });
                } else {
                    this.push(null);
                }
            } else {
                var stop = false;
                while (self.unsortedItems.length > 0 && !stop) {
                    var chunk = self.unsortedItems.shift();
                    stop = !this.push(chunk);
                }
            }
        }
    });
    this.outStream = new stream.Writable({
        "objectMode": true,
        "write": function(chunk, encoding, callback) {
            self.sortedItems.push(chunk);
            callback();
        }
    });
    self.sortedEnded = false;
    this.outStream.on("finish", function() {
        self.sortedEnded = true;
    });
}

/**
 * Call when feeds are push in input 
 * @param {mixed} chunk
 * @param {type} enc
 * @param {type} cb
 * @returns {undefined}
 */
AggregatorStream.prototype._write = function(chunk, enc, cb) {
    this.processingFeeds++;
    if (!this.started) {
        this.started = true;
        this.inStream
            .pipe(this.sortStream)
            .pipe(this.outStream);
    }
    this.queue.push(typeof chunk === "string" ? chunk : chunk.toString());
    cb();
};

/**
 * Read items extracted from feeds
 * @returns {undefined}
 */
AggregatorStream.prototype._read = function() {
    if (this.sortedItems.length === 0) {
        if (this.processingFeeds || !this.sortedEnded) {
            var stream = this;
            setImmediate(function() {
                stream._read();
            });
        } else {
            this.push(null);
        }
    } else {
        var stop = false;
        while (this.sortedItems.length > 0 && !stop) {
            var chunk = this.sortedItems.shift();
            stop = !this.push(chunk);
        }
    }
};

/**
 * Parse a feed
 * @param {string} url
 * @returns {Promise}
 */
AggregatorStream.prototype.parse = function(url) {
    var self = this;
    return new Promise(function(resolve, reject) {
        try {
            var parser = new self.FeedParser();
            var req = self.request(url);
            req.on("error", function(err) {
                reject(new Error(
                    "Error requesting feed: %s",
                    url,
                    err
                ));
            });
            req.on("response", function(response) {
                var stream = this;
                if (response.statusCode !== 200) {
                    reject(new Error(
                        "Bad status code: %s",
                        response.statusCode
                    ));
                } else {
                    stream.pipe(parser);
                }
            });
            parser.on("error", function(err) {
                reject(new Error(
                    "Error parsing feed: %s",
                    url,
                    err
                ));
            });
            parser.on("readable", function() {
                try {
                    var item;
                    while ((item = this.read())) {
                        self.unsortedItems.push(item);
                    }
                } catch (err) {
                    reject(new Error(
                        "Error readning feed: %s",
                        url,
                        err
                    ));
                }
            });
            parser.on("end", function() {
                resolve(true);
            });
        } catch (err) {
            reject(err);
        }
    });
};

util.inherits(AggregatorStream, Duplex);
module.exports = AggregatorStream;
