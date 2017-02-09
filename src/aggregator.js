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
                    callback();
                    return;
                })
                .catch(function(err) {
                    self.emit("error", new Error(
                        "Error parsing feed: %s",
                        feed, err));
                    callback(err);
                });
        },
        self.concurrency
    );
    this.items = [];
}

/**
 * Call when feeds are push in input 
 * @param {mixed} chunk
 * @param {type} enc
 * @param {type} cb
 * @returns {undefined}
 */
AggregatorStream.prototype._write = function(chunk, enc, cb) {
    this.queue.push(typeof chunk === "string" ? chunk : chunk.toString());
    cb();
};

/**
 * Read items extracted from feeds
 * @returns {undefined}
 */
AggregatorStream.prototype._read = function() {
    // We have nothing to read
    if (!this.items.length) {
        // Nothing is processing, we end
        if (this.queue.idle()) {
            this.push(null);
        } else {
            // Something is processing, we push a new read at the end of the
            // event loop 
            var self = this;
            setImmediate(function() {
                self._read();
            });
        }
    } else {
        var stop = false;
        while (this.items.length > 0 && !stop) {
            var chunk = this.items.shift();
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
                new Error(
                    "Error requesting feed: %s",
                    url,
                    err
                );
            });
            req.on("response", function(response) {
                var stream = this;
                if (response.statusCode !== 200) {
                    this.emit("error", new Error(
                        "Bad status code: %s",
                        response.statusCode
                    ));
                } else {
                    stream.pipe(parser);
                }
            });
            parser.on("error", function(err) {
                new Error(
                    "Error parsing feed: %s",
                    url,
                    err
                );
            });
            parser.on("readable", function() {
                var item;
                while ((item = this.read())) {
                    self.items.push(item);
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

/**
 * Call when output stream is piped
 * @param {WritableStream} out
 * @returns {ReadableStream}
 */
AggregatorStream.prototype.pipe = function(out) {
    // Pipe sort stream to aggregator
    Duplex.prototype.pipe.apply(this, [this.sortStream]);
    // Pipe output to readable stream
    return this.sortStream.pipe(out);
};

/**
 * Call when output stream is unpiped
 * @param {WritableStream} out
 * @returns {ReadableStream}
 */
AggregatorStream.prototype.unpipe = function() {
    // Unpipe sortStream from aggregator
    Duplex.prototype.unpipe.apply(this, [this.sortStream]);
};

util.inherits(AggregatorStream, Duplex);
module.exports = AggregatorStream;
