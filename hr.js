const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

var gEAR, gDB, gOS, gEIS, gHR, gEAM;
const DataFactory = {
    corpdata:   { query: 'select * from corporations where id=:id' },
    chardata:   { query: 'select * from characters where id=:id' },
    assets:     { query: 'select * from assets where owner=:owner' },
    towers:     { query: 'select * from assets where owner=:owner and location is not NULL' },
    members:    { query: 'select * from characters where corporation=:id' },
};

function EveCharacter(id) {
    this._id = id;
    let {name: name, corporation: corp, account: acct} = DataFactory.chardata.func(id);
    this._name = name;
    this._corporation = gHR.getCorporation(corp);
    this._account = acct;
}

EveCharacter.prototype = {
    classDescription:   "EVE Character",
    classID:            Components.ID("{2595b442-53bf-4567-a3fc-0b8531253620}"),
    contractID:         "@aragaer/eve-character;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveCharacter]),

    get id()            this._id,
    get name()          this._name,
    get corporation()   this._corporation,
    get account()       this._account,

    getAssets:  function (out) {
        var result = [];
        let stm = DataFactory.assets.stm;
        stm.params.owner = this._id;
        try {
            while (stm.step())
                result.push(gEIS.createItem('fromStm', stm));
        } catch (e) {
            dump("Character "+this._name+" assets: "+e.toString()+"\n");
        } finally {
            stm.reset();
        }
        out.value = result.length;
        return result;
    },

    getAssetsAsync: function (handler) {
        var result = [], tok;
        if (tok = gEAM.getTokenForChar(this, Ci.nsEveAuthTokenType.TYPE_FULL))
            gEAR.refreshData('charassets', {wrappedJSObject: {
                userID:     tok.accountID,
                apiKey:     tok.apiKey,
                characterID:tok.characterID,
                owner:      this._id,
            }});

        let stm = DataFactory.assets.stm;
        stm.params.owner = this._id;
        stm.executeAsync({
            handleError:        handler.onError,
            handleCompletion:   handler.onCompletion,
            handleResult:       function (r) {
                while (row = r.getNextRow())
                    handler.onItem(gEIS.createItem('fromRow', row));
            },
        });
    },


    getAuthToken:       function (type) gEAM.getTokenForChar(this, type),
};

function EveCorporation(id) {
    this._id = id;
    let {name: name} = DataFactory.corpdata.func(id);
    this._name = name;
}

EveCorporation.prototype = {
    classDescription:   "EVE Corporation",
    classID:            Components.ID("{ab672ffc-b203-4e54-b231-1b6ea9365bac}"),
    contractID:         "@aragaer/eve-corporation;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveCorporation]),

    get id()    this._id,
    get name()  this._name,

    getMembers: function (out) {
        var result = [gHR.getCharacter(c.id) for each (c in DataFactory.members.func(this._id))];
        out.value = result.length;
        return result;
    },

    getControlTowersAsync:  function (handler)
            this._getAssetsAsync(DataFactory.towers.stm, handler),
    getAssetsAsync:         function (handler)
            this._getAssetsAsync(DataFactory.assets.stm, handler),

    _getAssetsAsync:        function (stm, handler) {
        var tok;
        if (tok = gEAM.getTokenForCorp(this, Ci.nsEveAuthTokenType.TYPE_DIRECTOR))
            gEAR.refreshData('corpassets', {wrappedJSObject: {
                userID:     tok.accountID,
                apiKey:     tok.apiKey,
                characterID:tok.characterID,
                owner:      this._id,
            }});

        stm.params.owner = this._id;
        stm.executeAsync({
            handleError:        handler.onError,
            handleCompletion:   handler.onCompletion,
            handleResult:       function (r) {
                while (row = r.getNextRow())
                    handler.onItem(gEIS.createItem('fromRow', row));
            },
        });
    },

    getAssets:  function (out) {
        var result = [], tok;
        dump("Getting assets\n");
        if (tok = gEAM.getTokenForCorp(this, Ci.nsEveAuthTokenType.TYPE_DIRECTOR))
            gEAR.refreshData('corpassets', {wrappedJSObject: {
                userID:     tok.accountID,
                apiKey:     tok.apiKey,
                characterID:tok.characterID,
                owner:      this._id,
            }});

        dump("refreshed\n");

        let stm = DataFactory.assets.stm;
        stm.params.owner = this._id;
        try {
            while (stm.step())
                result.push(gEIS.createItem('fromStm', stm));
        } catch (e) {
            dump("Corporation "+this._name+" assets: "+e.toString()+"\n");
        } finally {
            stm.reset();
        }
        dump("done!\n");
        out.value = result.length;
        return result;
    },

    getAuthToken:       function (type) gEAM.getTokenForCorp(this, type),
};

function EveHRManager() {
    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    gEAR = Cc["@aragaer/eve/api-requester;1"].getService(Ci.nsIEveApiRequester);
    gEAM = Cc["@aragaer/eve/auth-manager;1"].getService(Ci.nsIEveAuthManager);
    gEIS = Cc["@aragaer/eve/inventory;1"].getService(Ci.nsIEveInventoryService);
    gDB = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
    gHR = this;
}

EveHRManager.prototype = {
    classDescription: "EVE API Human Resources manager",
    classID:          Components.ID("{01844e7a-b187-4411-b687-ec4cccb38cd4}"),
    contractID:       "@aragaer/eve-hr-manager;1",
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIEveHRManager, Ci.nsIObserver]),
    _xpcom_categories: [{
        category: "app-startup",
        service: true
    }],

    observe:        function (aSubject, aTopic, aData) {
        switch (aTopic) {
        case 'app-startup':
            gOS.addObserver(this, 'eve-db-init', false);
            DataFactory.corpdata.func = createDataFunc('corpdata');
            DataFactory.chardata.func = createDataFunc('chardata');
            DataFactory.members.func = createListFunc('members');
            break;
        case 'eve-db-init':
            this._conn = gDB.getConnection();
            if (!this._conn.tableExists('corporations'))
                this._conn.createTable('corporations',
                        'name char, ticker char, id integer, ' +
                        'alliance integer, primary key (id)');
            if (!this._conn.tableExists('characters'))
                this._conn.createTable('characters',
                        'name char, id integer, account integer, ' +
                        'corporation integer, primary key (id)');

            for each (i in DataFactory)
                i.stm = this._conn.createStatement(i.query);
            this._getCorpListStm = this._conn.createStatement('select id from corporations;');
            break;
        }
    },

    _corporations:  null,
    _characters:    {},

    getAllCorporations:     function (out) {
        var res = [];
        let stm = this._getCorpListStm;
        if (!this._corporations)
            this._corporations = [];
        try {
            while (stm.step()) {
                let corpID = stm.row.id;
                if (!this._corporations['c'+corpID])
                    this._corporations['c'+corpID] = new EveCorporation(corpID);
                res.push(this._corporations['c'+corpID]);
            }
        } catch (e) {
            dump("getAllCorporations:"+e.toString()+"\n");
        } finally {
            stm.reset;
        }
        out.value = res.length;
        return res;
    },

    getCorporation:         function (corpID) {
        if (!this._corporations)
            this.getAllCorporations({});
        return this._corporations['c'+corpID];
    },

    getCharacter:           function (charID) {
        if (!this._characters['c'+charID])
            this._characters['c'+charID] = new EveCharacter(charID);
        return this._characters['c'+charID];
    },

    _getCharFromStmRow:     function (row) {
        if (!this._characters['c'+row.id])
            this._characters['c'+row.id] = new EveCharacter(stm.row.id);
        return this._characters['c'+row.id];
    },
};

var components = [EveHRManager, EveCorporation, EveCharacter];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}

function columnList(stm) {
    for (let i = 0; i < stm.columnCount; i++)
        yield stm.getColumnName(i);
}

function createDataFunc(stmname) {
    return function (id) {
        var result = {};
        var stm = DataFactory[stmname].stm;
        try {
            stm.params.id = id;
            stm.step();
            [result[col] = stm.row[col] for (col in columnList(stm))];
        } catch (e) {
            dump(e.toString()+"\n");
        } finally {
            stm.reset();
        }
        return result;
    }
}

function createListFunc(stmname) {
    return function (id) {
        var out = [];
        var stm = DataFactory[stmname].stm;
        try {
            stm.params.id = id;
            while (stm.step()) {
                var result = {};
                [result[col] = stm.row[col] for (col in columnList(stm))];
                out.push(result);
            }
        } catch (e) {
            dump(e.toString()+"\n");
        } finally {
            stm.reset();
        }
        return out;
    }
}

