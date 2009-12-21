const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const EVEAPIURL = "http://api.eve-online.com";

const EVEURLS = {
    serverStatus:   { url: "/server/ServerStatus.xml.aspx", cb: [] },
    characters:     { url: "/account/Characters.xml.aspx",  cb: [] },
    charsheet:      { url: "/char/CharacterSheet.xml.aspx", cb: [] },
    charassets:     { url: "/char/AssetList.xml.aspx",      cb: [] },
    corpassets:     { url: "/corp/AssetList.xml.aspx",      cb: [] },
};

var gOS;

function eveRequester() {
    this.cache_session = Cc["@mozilla.org/network/cache-service;1"].
            getService(Ci.nsICacheService).createSession("EVE API",
                    Ci.nsICache.STORE_OFFLINE, true);

    this._fromCache = this._fromCache_real;

    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
}

eveRequester.prototype = {
    classDescription:   "EVE Online API requester",
    classID:            Components.ID("{4ba2f4f7-12bc-4194-81ee-fc5e434e8073}"),
    contractID:         "@aragaer/eve/api-requester;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveApiRequester]),

    _xpcom_categories: [{
        category: "app-startup",
        service: true
    }],

    refreshData:        function (type, data) {
        if (!EVEURLS[type])
            return;
        dump("refreshing data\n");
        var dwjso = data ? data.wrappedJSObject : null;
        var res = this._fetchXML(EVEAPIURL+EVEURLS[type].url, data
                ? [i+'='+escape(dwjso[i]) for (i in dwjso)].join('&')
                : '');
        if (res)
            gOS.notifyObservers({
                wrappedJSObject: {doc: res, aux: data}
            }, 'eve-data', type);
    },

    _makeHash:          function (str) {
        var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
                createInstance(Ci.nsIScriptableUnicodeConverter);
        converter.charset = "UTF-8";
        var result = {};
        // data is an array of bytes
        var data = converter.convertToByteArray(str, result);
        var hasher = Cc["@mozilla.org/security/hash;1"].
                createInstance(Ci.nsICryptoHash);
        hasher.init(hasher.MD5);
        hasher.update(data, data.length);
        var hash = hasher.finish(false);
        function toHexString(c) { return ("00" + c.toString(16)).slice(-2); }
        return [toHexString(hash.charCodeAt(i)) for (i in hash)].join("");
    },

    _fromCache_null:    function (cd) { cd.close(); return null; },
    _fromCache_real:    function (cd) {
        var result = null;
        if (cd.accessGranted == Ci.nsICache.ACCESS_READ_WRITE) {
            var stream = cd.openInputStream(0);
            var parser = Cc["@mozilla.org/xmlextras/domparser;1"].
                    createInstance(Ci.nsIDOMParser);
            result = parser.parseFromStream(stream, "UTF-8",
                    stream.available(), "text/xml");
            stream.close();
        } else {
            cd.doom();
        }
        cd.close();
        return result;
     },
 
    _fetchXML:          function (url, data) {
        var result;
        var cacheKey = url + '?stamp=' + this._makeHash(data);
        dump("Fetching "+cacheKey+"\n");
        dump("data ["+data+"]\n");
        var cd = this.cache_session.openCacheEntry(cacheKey, Ci.nsICache.ACCESS_READ_WRITE, true);
        if (cd.accessGranted == Ci.nsICache.ACCESS_READ_WRITE   // It exists
                && cd.expirationTime*1000 > Date.now()) {       // And it is valid
            dump("Using cache now\n");
            return this._fromCache(cd);
        }
 
        var req = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                createInstance(Ci.nsIXMLHttpRequest);
        req.open('POST', url, false);
        req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
        try {
            var t = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
            t.initWithCallback(req.abort, 5000, t.TYPE_ONE_SHOT);
            req.send(data);
            t.cancel();
        } catch (e) {
            dump(e.toString()+"\n");
            req = {status: 0};
        }
        if (req.status != 200) {
            dump('Failed to connect to server!\n');
            gOS.notifyObservers(null, 'eve-data-error', 'Failed to connect to server '+req.status);
            return this._fromCache(cd);
        }
 
        result = req.responseXML;
//        dump(req.responseText+"\n");
 
        var error = evaluateXPath(result, "/eveapi/error/text()")[0];
        if (error) {
            dump("REQUESTER ERROR:"+error.wholeText+"\n");
            gOS.notifyObservers(null, 'eve-data-error', error.wholeText);
            return this._fromCache(cd);
        }

        gOS.notifyObservers(null, 'eve-data-error', '');
 
        var serializer = Cc["@mozilla.org/xmlextras/xmlserializer;1"].
            createInstance(Ci.nsIDOMSerializer);
        var os = cd.openOutputStream(0);
        serializer.serializeToStream(result, os, "");
        os.close();
 
        var curtime = evaluateXPath(result, "/eveapi/currentTime/text()")[0].data;
        var cached_until = evaluateXPath(result, "/eveapi/cachedUntil/text()")[0].data;
        dump("Got on ["+curtime+"] expires on ["+cached_until+"]\n");
        cd.setExpirationTime(Date.UTCFromEveTimeString(cached_until)/1000);
        cd.markValid();
        cd.close();
 
        return result;
    },
}

var components = [eveRequester];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}

function evaluateXPath(aNode, aExpr) {
    var found = [];
    var res, result;
    var xpe = Cc["@mozilla.org/dom/xpath-evaluator;1"].
            createInstance(Ci.nsIDOMXPathEvaluator);
    var nsResolver = xpe.createNSResolver(aNode.ownerDocument == null
            ? aNode.documentElement
            : aNode.ownerDocument.documentElement);
    try {
        result = xpe.evaluate(aExpr, aNode, nsResolver, 0, null);
    } catch (e) {
        dump("error running xpe with expression '"+aExpr+"'\nCaller:"+
              evaluateXPath.caller+"\n");
        return found;
    }
    while (res = result.iterateNext())
        found.push(res);
    return found;
}

Date.UTCFromEveTimeString = function (str) {
    var d = str.split(/:| |-/);
    d[1]--; // Month
 
    return Date.UTC(d[0], d[1], d[2], d[3], d[4], d[5]);
}

