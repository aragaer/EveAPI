const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

const EVEAPIURL = "http://api.eve-online.com";

const EVEURLS = {
    characters:     "/account/Characters.xml.aspx",

    charcash:       "/char/AccountBalance.xml.aspx",
    charassets:     "/char/AssetList.xml.aspx",
    charsheet:      "/char/CharacterSheet.xml.aspx",
    charfacwar:     "/char/FacWarStats.xml.aspx",
    charjobs:       "/char/IndustryJobs.xml.aspx",
    charkills:      "/char/Killlog.xml.aspx",
    charmaillists:  "/char/MailingLists.xml.aspx",
    charmail:       "/char/MailMessages.xml.aspx",
    charmarket:     "/char/MarketOrders.xml.aspx",
    charmedals:     "/char/Medals.xml.aspx",
    charnotificat:  "/char/Notifications.xml.aspx",
    charresearch:   "/char/Research.xml.aspx",
    chartraining:   "/char/SkillInTraining.xml.aspx",
    charqueue:      "/char/SkillQueue.xml.aspx",
    charstandings:  "/char/Standings.xml.aspx",
    charwalletjour: "/char/WalletJournal.xml.aspx",
    charwallettrans:"/char/WalletTransactions.xml.aspx",

    corpcash:       "/corp/AccountBalance.xml.aspx",
    corpassets:     "/corp/AssetList.xml.aspx",
    corpcontlog:    "/corp/ContainerLog.xml.aspx",
    corpsheet:      "/corp/CorporationSheet.xml.aspx",
    corpfacwar:     "/corp/FacWarStats.xml.aspx",
    corpjobs:       "/corp/IndustryJobs.xml.aspx",
    corpkills:      "/corp/Killlog.xml.aspx",
    corpmarket:     "/corp/MarketOrders.xml.aspx",
    corpmedals:     "/corp/Medals.xml.aspx",
    corpmembmedals: "/corp/MemberMedals.xml.aspx",
    corpsecurity:   "/corp/MemberSecurity.xml.aspx",
    corpseclog:     "/corp/MemberSecurityLog.xml.aspx",
    corptracking:   "/corp/MemberTracking.xml.aspx",
    corpposdetails: "/corp/StarbaseDetail.xml.aspx",
    corpposlist:    "/corp/StarbaseList.xml.aspx",
    corpshares:     "/corp/Shareholders.xml.aspx",
    corpstandings:  "/corp/Standings.xml.aspx",
    corptitles:     "/corp/Titles.xml.aspx",
    corpwalletjour: "/corp/WalletJournal.xml.aspx",
    corpwallettrans:"/corp/WalletTransactions.xml.aspx",

    alliancelist:   "/eve/AllianceList.xml.aspx",
    certlist:       "/eve/CertificateTree.xml.aspx",
    conqstalist:    "/eve/ConquerableStationList.xml.aspx",
    errorlist:      "/eve/ErrorList.xml.aspx",
    facwarstats:    "/eve/FacWarStats.xml.aspx",
    facwartop:      "/eve/FacWarTopStats.xml.aspx",
    charname:       "/eve/CharacterName.xml.aspx",
    charid:         "/eve/CharacterID.xml.aspx",
    reftypes:       "/eve/RefTypes.xml.aspx",
    skilltree:      "/eve/SkillTree.xml.aspx",

    mapfacwar:      "/map/FacWarSystems.xml.aspx",
    mapjumps:       "/map/Jumps.xml.aspx",
    mapkills:       "/map/Kills.xml.aspx",
    mapsov:         "/map/Sovereignty.xml.aspx",
    mapsovstatus:   "/map/SovereigntyStatus.xml.aspx",

    serverStatus:   "/server/ServerStatus.xml.aspx",
};

var gOS, gDB, gHR, gEAR;

function eveRequester() {
    this.cache_session = Cc["@mozilla.org/network/cache-service;1"].
            getService(Ci.nsICacheService).createSession("EVE API",
                    Ci.nsICache.STORE_OFFLINE, true);

//    this._fromCache = this._fromCache_real;
    this._fromCache = this._fromCache_null;

    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    gEAR = this;
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
        if (!res)
            return;
        gOS.notifyObservers({ wrappedJSObject: {doc: res, aux: data} },
                'eve-data', type);
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
            gOS.notifyObservers(null, 'eve-data-error', '');
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
    set characterID(id) this._characterID = id,
}

function StmName(FuncName) "_"+FuncName+"Stm";
const AuthDataStm = {
    getAcct:        'select * from accounts where acct_id=:acct_id;',
    storeAcct:      'replace into accounts (name, acct_id, ltd, full) ' +
            'values(:name, :accountID, :keyLimited, :keyFull)',
    deleteAcct:     'delete from accounts where acct_id=:acct_id;',
    getAccts:       'select * from accounts;',
    getAcctChars:   'select * from characters where account=:acct_id;',
    getCharKeys:    'select ltd, full from characters ' +
                "left join accounts on account=accounts.acct_id " +
                "where characters.id=:char_id;",
};

var gAM;
function authman() {
    gAM = this;
}

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
            Services.obs.addObserver(this, 'eve-db-init', false);
            break;
        case 'eve-db-init':
            gDB = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
            try {
                this._conn = aSubject.QueryInterface(Ci.mozIStorageConnection);
                gDB.getConnection();
                dump("Conn = "+this._conn+"\n");
                if (!this._conn.tableExists('accounts'))
                    this._conn.createTable('accounts',
                            'name char, acct_id integer, ltd char, full char, ' +
                            'primary key (acct_id)');
            } catch (e) {
                dump(e.toString()+"\n"+this._conn.lastErrorString+"\n");
            }

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
    },
    getTokenForAccount:     function (account, type) {
        let stm = this._getAcctStm;
        stm.params.acct_id = account;
        let key = this._keyFromStm(stm, type);
        return key
            ? new eveAuth({accountID: account, type: type, apiKey: key})
            : null;
    },

    getTokenForChar:        function (character, type) {
        var tok = this.getTokenForAccount(character.account, type);
        if (tok)
            tok.characterID = character.id;
        return tok;
    },

    getTokenForCorp:        function (corporation, type) {
        var ch = corporation.getMembers({})[0];
        return ch
            ? this.getTokenForChar(ch, type)
            : null;
    },

    getAccounts:      function (out) {
        var result = [];
        let stm = this._getAcctsStm;
        try {
            while (stm.step())
                result.push((new eveacct())._initFromData(stm.row));
        } catch (e) {
            dump("Get all accounts: "+e+"\n");
        } finally {
            stm.reset();
        }
        out.value = result.length;
        return result;
    },
};

function eveacct() {
    this.name = '';
    this.accountID = 0;
    this.keyLimited = '';
    this.keyFull = '';
}

eveacct.prototype = {
    classDescription:   "EVE Online account",
    classID:            Components.ID("{8b787ff0-a7a2-4e6e-adee-09abaa4b80a3}"),
    contractID:         "@aragaer/eve/account;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveAccount]),

    store:              function () {
        dump("Store account "+this.accountID+"\n");
        let stm = gAM._storeAcctStm;
        try {
            for each (i in ['name', 'accountID', 'keyLimited', 'keyFull']) {
                dump(i + " = " + this[i] + "\n");
                stm.params[i] = this[i];
            }
            stm.execute();
        } catch (e) {
            dump("Store account "+this.name+": "+e+"\n");
        } finally {
            stm.reset();
        }
    },
    delete:             function () {
        dump("Delete account "+this.accountID+"\n");
        let stm = gAM._deleteAcctStm;
        try {
            stm.params.acct_id = this.accountID;
            stm.execute();
        } catch (e) {
            dump("Delete account "+this.name+": "+e+"\n");
        } finally {
            stm.reset();
        }
    },
    initFromID:         function (id) {
        let stm = gAM._getAcctStm;
        stm.params.id = id;
        try {
            stm.step();
            this.name = stm.row.name;
            this.accountID = id;
            this.keyFull = stm.row.ltd;
            this.keyLimited = stm.row.full;
        } catch (e) {
            dump("Acct from id "+id+": "+e+"\n");
        } finally {
            stm.reset();
        }
    },
    _initFromData:      function (row) {
        this.accountID = row.acct_id;
        this.name = row.name;
        this.keyFull = row.full;
        this.keyLimited = row.ltd;
        return this;
    },
    getCharacters:      function (out) {
        var result = [];
        if (!this.accountID) {
            out.value = 0;
            return [];
        }
        if (!gHR)
            gHR = Cc["@aragaer/eve-hr-manager;1"].getService(Ci.nsIEveHRManager);
        let stm = gAM._getAcctCharsStm;
        stm.params.acct_id = this.accountID;
        try {
            while (stm.step())
                result.push(gHR.getCharacter(stm.row.id));
        } catch (e) {
            dump("Get chars for account "+this.accountID+": "+e+"\n");
        } finally {
            stm.reset();
        }
        out.value = result.length;
        return result;
    },

    checkLimited:       function (handler) {
        gOS.addObserver({
            observe: function (aTopic, aSubject, aData) {
                try {
                gOS.removeObserver(this, 'eve-data-error');
                dump("done checking limited key\n");
                handler.processResult(aData == '');
                } catch (e) { dump(""+e+"\n"); }
            }
        }, 'eve-data-error', false);
        gEAR.refreshData('characters', {
            wrappedJSObject: {userID: this.accountID, apiKey: this.keyLimited || this.keyFull}
        });
    },

    checkFull:          function (handler) {
        var ch = this.getCharacters({})[0];
        if (!ch)
            return handler.processResult(false);
        gOS.addObserver({
            observe: function (aTopic, aSubject, aData) {
                try {
                gOS.removeObserver(this, 'eve-data-error');
                handler.processResult(aData == '');
                dump("done checking full key\n");
                } catch (e) { dump(""+e+"\n"); }
            }
        }, 'eve-data-error', false);
        gEAR.refreshData('charcash', {
            wrappedJSObject: {userID: this.accountID, apiKey: this.keyFull, characterID: ch.id}
        });
    },

};

var components = [eveRequester, eveAuth, authman, eveacct];

if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule(components);

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

