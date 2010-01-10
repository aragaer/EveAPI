const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const EVEAPIURL = "http://api.eve-online.com";

const EVEURLS = {
    serverStatus:   "/server/ServerStatus.xml.aspx",
    characters:     "/account/Characters.xml.aspx",
    charsheet:      "/char/CharacterSheet.xml.aspx",
    charassets:     "/char/AssetList.xml.aspx",
    corpassets:     "/corp/AssetList.xml.aspx",
    corptowers:     "/corp/StarbaseList.xml.aspx",
    towerdetails:   "/corp/StarbaseDetail.xml.aspx",
};

var gOS;

function eveRequester() {
    this.cache_session = Cc["@mozilla.org/network/cache-service;1"].
            getService(Ci.nsICacheService).createSession("EVE API",
                    Ci.nsICache.STORE_OFFLINE, true);

//    this._fromCache = this._fromCache_real;
    this._fromCache = this._fromCache_null;

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
        var res = this._fetchXML(EVEAPIURL+EVEURLS[type], data
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

function eveAuth(data) {
    for (field in data)
        this['_'+field] = data[field];
}

eveAuth.prototype = {
    classDescription:   "EVE Online authentication token",
    classID:            Components.ID("{5eaf7e07-9a14-4ba6-8439-2c1ce1c3a7a4}"),
    contractID:         "@aragaer/eve/auth-token;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveAuthToken]),

    get accountID()     this._accountID,
    get apiKey()        this._apiKey,
    get type()          this._type,
    get characterID()   this._characterID,
}

function StmName(FuncName) "_"+FuncName+"Stm";
const AuthDataStm = {
    getAcctKeys:    'select ltd, full from accounts where acct_id=:acct_id;',
    getCharKeys:    'select ltd, full from characters ' +
                "left join accounts on account=accounts.acct_id " +
                "where characters.id=:char_id;",
};
function authman() { }

authman.prototype = {
    classDescription:   "EVE Online authentication manager",
    classID:            Components.ID("{df6010ca-4902-43c1-a5f7-6d2aa86ddcad}"),
    contractID:         "@aragaer/eve/auth-manager;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveAuthManager, Ci.nsIObserver]),

    _xpcom_categories: [{
        category: "app-startup",
        service: true
    }],

    observe:        function (aSubject, aTopic, aData) {
        switch (aTopic) {
        case 'app-startup':
            gOS.addObserver(this, 'eve-db-init', false);
            break;
        case 'eve-db-init':
            this._conn = gDB.getConnection();
            if (!this._conn.tableExists('accounts'))
                this._conn.createTable('accounts',
                        'name char, id integer, acct_id integer, ltd char, ' +
                        'full char, primary key (id)');

            for (i in AuthDataStm)
                try {
                    this[StmName(i)] = this._conn.createStatement(AuthDataStm[i]);
                } catch (e) {
                    dump('Error in statement "' + AuthDataStm[i] + '": ' +
                            this._conn.lastErrorString+"\n");
                }
            break;
        }
    },

    _keyFromStm:            function (stm, type) {
        var result;
        try {
            if (stm.step())
                switch (type) {
                case Ci.nsEveAuthTokenType.TYPE_NOCHAR:
                case Ci.nsEveAuthTokenType.TYPE_LIMITED:
                default:
                    result = stm.row.ltd;
                    break;
                case Ci.nsEveAuthTokenType.TYPE_FULL:
                case Ci.nsEveAuthTokenType.TYPE_DIRECTOR:
                    result = stm.row.full;
                    break;
                }
        } catch (e) {
            dump(e.toString()+"\n");
        } finally {
            stm.reset();
        }
        return result;
    }
    getTokenForAccount:     function (account, type) {
        let stm = this._getAcctKeysStm;
        stm.params.acct_id = account;
        let key = this._keyFromStm(stm, type);
        return key
            ? new eveAuth({accountID: account, type: type, apiKey: key})
            : null;
    },

    getTokenForChar:        function (character, type)
            this.getTokenForAccount(character.account, type),

    getTokenForCorp:        function (corporation, type) {
        var ch = corporation.getMembers()[0];
        return this.getTokenForChar(ch, type);
    },
};

var components = [eveRequester, eveAuth, authman];
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

