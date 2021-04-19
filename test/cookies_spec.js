"use strict";

const { test } = require("tap");
const utils = require("./test_utils.js");
const { getData } = utils;
const cookies = require("../lib/cookies.js");
const { PassThrough } = require("stream");
const concat = require("concat-stream");

test("should copy cookies and redirect in response to a __proxy_cookies_to query param", function (t) {
  t.plan(2);
  const instance = cookies({
    prefix: "/proxy/",
    processContentTypes: [],
  });
  const data = getData();
  data.url.search = "?__proxy_cookies_to=https%3A%2F%2Fexample.com%2F";
  data.headers.cookie = "one=1; two=2; three=3";
  data.clientResponse = {
    redirectTo: function (path, headers) {
      const expectedPath = "https://example.com/";
      const expectedHeaders = {
        "set-cookie": [
          "one=1; Path=/proxy/https://example.com/",
          "two=2; Path=/proxy/https://example.com/",
          "three=3; Path=/proxy/https://example.com/",
        ],
      };
      t.equal(path, expectedPath);
      t.same(headers, expectedHeaders);
      t.end();
    },
  };
  instance.handleRequest(data);
});

test("should rewrite set-cookie paths", function (t) {
  const instance = cookies({
    prefix: "/proxy/",
    processContentTypes: [],
  });
  const data = getData();
  data.headers["set-cookie"] = ["one=1", "two=2; path=/", "three=3; path=/foo"];
  instance.handleResponse(data);
  const expected = [
    "one=1; Path=/proxy/http://example.com/",
    "two=2; Path=/proxy/http://example.com/",
    "three=3; Path=/proxy/http://example.com/foo",
  ];
  const actual = data.headers["set-cookie"];
  t.same(actual, expected);
  t.end();
});

test("should rewrite the cookie that is percent-encoded correctly", function (t) {
  const instance = cookies({
    prefix: "/proxy/",
    processContentTypes: [],
  });
  const data = getData();
  data.headers["set-cookie"] = [
    "asdf=asdf%3Basdf%3Dtrue%3Basdf%3Dasdf%3Basdf%3Dtrue%40asdf",
  ];
  instance.handleResponse(data);
  const expected = [
    "asdf=asdf%3Basdf%3Dtrue%3Basdf%3Dasdf%3Basdf%3Dtrue%40asdf; Path=/proxy/http://example.com/",
  ];
  const actual = data.headers["set-cookie"];
  t.same(actual, expected);
  t.end();
});

test("should copy any missing cookies to a 3xx redirect", function (t) {
  t.plan(1);
  const instance = cookies({
    prefix: "/proxy/",
    processContentTypes: ["text/html"],
  });
  const data = getData();
  data.clientRequest = {
    headers: {
      cookie: "one=oldvalue; two=2",
    },
  };
  data.headers = {
    "set-cookie": "one=1; Path=/; HttpOnly",
  };
  data.redirectHref = "https://example.com/"; // this is normally set by the redirects middleware before it changes the location header
  instance.handleResponse(data);
  const expected = {
    "set-cookie": [
      "one=1; Path=/proxy/https://example.com/; HttpOnly",
      "two=2; Path=/proxy/https://example.com/",
    ],
  };
  t.same(data.headers, expected);
});

test("should rewrite urls that change subdomain or protocol (but not domain)", function (t) {
  t.plan(2);
  const instance = cookies({
    prefix: "/proxy/",
    processContentTypes: ["text/html"],
  });
  const data = getData();
  const sourceStream = new PassThrough({
    encoding: "utf8",
  });
  data.stream = sourceStream;
  instance.handleResponse(data);
  t.not(
    data.stream,
    sourceStream,
    "cookies.handleResponse should create a new stream to process content"
  );
  const source = [
    '<a href="/proxy/http://example.com/">no change</a>',
    '<a href="/proxy/https://example.com/">new proto</a>',
    '<a href="/proxy/http://sub.example.com/">new subdomain</a>',
    '<a href="/proxy/http://sub.example.com/path">new subdomain, with path</a>',
    '<a href="/proxy/http://sub.example.com/?foo=bar">new subdomain, with querystring</a>',
    '<a href="/proxy/http://othersite.com/">other site, same proto</a>',
    '<a href="/proxy/https://othersite.com/">other site, dif proto</a>',
    '<a href="/proxy/http://cdnexample.com/">other site, same ending in domain</a>',
    '<a href="javascript:void(0)" onclick="window.open(\'/proxy/http://sub.example.com/\')">new subdomain using inline JS</a>',
    '<img src="/proxy/http://example.com/img.jpg" alt="no change" />',
    '<img src="/proxy/https://example.com/img.jpg" alt="new proto">',
  ].join("\n");

  const expected = [
    '<a href="/proxy/http://example.com/">no change</a>',
    '<a href="/proxy/http://example.com/?__proxy_cookies_to=https%3A%2F%2Fexample.com%2F">new proto</a>',
    '<a href="/proxy/http://example.com/?__proxy_cookies_to=http%3A%2F%2Fsub.example.com%2F">new subdomain</a>',
    '<a href="/proxy/http://example.com/?__proxy_cookies_to=http%3A%2F%2Fsub.example.com%2Fpath">new subdomain, with path</a>',
    '<a href="/proxy/http://example.com/?__proxy_cookies_to=http%3A%2F%2Fsub.example.com%2F%3Ffoo%3Dbar">new subdomain, with querystring</a>',
    '<a href="/proxy/http://othersite.com/">other site, same proto</a>',
    '<a href="/proxy/https://othersite.com/">other site, dif proto</a>',
    '<a href="/proxy/http://cdnexample.com/">other site, same ending in domain</a>',
    '<a href="javascript:void(0)" onclick="window.open(\'/proxy/http://example.com/?__proxy_cookies_to=http%3A%2F%2Fsub.example.com%2F\')">new subdomain using inline JS</a>',
    '<img src="/proxy/http://example.com/img.jpg" alt="no change" />',
    '<img src="/proxy/http://example.com/?__proxy_cookies_to=https%3A%2F%2Fexample.com%2Fimg.jpg" alt="new proto">',
  ].join("\n");

  data.stream.setEncoding("utf8");
  data.stream.pipe(
    concat(function (actual) {
      t.equal(actual, expected);
      t.end();
    })
  );

  sourceStream.end(source);
});

test("should work with SameSite attributes", function (t) {
  const instance = cookies({
    prefix: "/proxy/",
    processContentTypes: [],
  });
  const data = getData();
  data.headers["set-cookie"] = [
    "1P_JAR=2019-12-19-00; expires=Sat, 18-Jan-2020 00:42:02 GMT; path=/; domain=.google.com; SameSite=none",
  ];
  instance.handleResponse(data);
  const [actual] = data.headers["set-cookie"];
  t.ok(actual.toLowerCase().indexOf("samesite=none") > -1);
  t.end();
});
