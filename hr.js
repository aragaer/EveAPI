const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

var gEAR, gDB, gOS, gEIS, gHR, gEAM;
const DataFactory = {
    corpdata:   { query: 'select * from corporations where id=:id' },
    chardata:   { query: 'select * from characters where id=:id' },
    assets:     { query: 'select * from assets where owner=:owner' },
    structures: { query: 'select assets.* from assets ' +
                    'left join static.invTypes as t on assets.typeID = t.typeID ' +
                    'left join static.invGroups as g on t.groupID = g.groupID ' +
                    'where location is not null and ' +
                    'g.categoryID = ' + Ci.nsEveCategoryID.CATEGORY_STRUCTURE + ' ' +
                    'and owner=:owner' },
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

    getControlTowersAsync:  function (handler) {
        this._getAssetsAsync(DataFactory.structures.stm, {
            onItem:         function (itm) {
                if (itm.type.group.id == Ci.nsEveItemGroupID.GROUP_CONTROL_TOWER)
                    handler.onItem(itm);
            },
            onCompletion:   handler.onCompletion,
            onError:        handler.onError,
        });
    },
    getStructuresAsync:     function (handler)
            this._getAssetsAsync(DataFactory.structures.stm, handler),
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
    if (gHR)
        return;
    gEAR = Cc["@aragaer/eve/api-requester;1"].getService(Ci.nsIEveApiRequester);
    gEAM = Cc["@aragaer/eve/auth-manager;1"].getService(Ci.nsIEveAuthManager);
    gEIS = Cc["@aragaer/eve/inventory;1"].getService(Ci.nsIEveInventoryService);
    gDB = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
    try {
        gHR._conn = gDB.getConnection();
        hr_init();
    } catch (e) {
        Services.obs.addObserver(this, 'eve-db-init', false);
    }
    gHR = this;
}

EveHRManager.prototype = {
    classDescription: "EVE API Human Resources manager",
    classID:          Components.ID("{01844e7a-b187-4411-b687-ec4cccb38cd4}"),
    contractID:       "@aragaer/eve-hr-manager;1",
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIEveHRManager, Ci.nsIObserver]),

    observe:        function (aSubject, aTopic, aData) {
        switch (aTopic) {
        case 'app-startup':
            Services.obs.addObserver(this, 'eve-db-init', false);
            DataFactory.corpdata.func = createDataFunc('corpdata');
            DataFactory.chardata.func = createDataFunc('chardata');
            DataFactory.members.func = createListFunc('members');
            break;
        case 'eve-db-init':
            try {
                gHR._conn = aSubject.QueryInterface(Ci.mozIStorageConnection);
                hr_init();
            } catch (e) {
                dump("Error in 'eve-db-init' in hr: "+e+"\n");
            }
            break;
        }
    },

    _corporations:  null,
    _characters:    {},

    getAllCorporations:     function (out) {
        var res = [];
        let stm = gHR._getCorpListStm;
        if (!gHR._corporations)
            gHR._corporations = [];
        try {
            while (stm.step()) {
                let corpID = stm.row.id;
                if (!gHR._corporations['c'+corpID])
                    gHR._corporations['c'+corpID] = new EveCorporation(corpID);
                res.push(gHR._corporations['c'+corpID]);
            }
        } catch (e) {
            dump("getAllCorporations:"+e.toString()+"\n");
        } finally {
            stm.reset;
        }
        out.value = res.length;
        return res;
    },

    getAllCharacters:       function (out) {
        var res = [];
        let stm = gHR._getCharListStm;
        try {
            while (stm.step()) {
                let charID = stm.row.id;
                if (!gHR._characters['c'+charID])
                    gHR._characters['c'+charID] = new EveCharacter(charID);
                res.push(gHR._characters['c'+charID]);
            }
        } catch (e) {
            dump("getAllCharacters:"+e.toString()+"\n");
        } finally {
            stm.reset;
        }
        out.value = res.length;
        return res;
    },

    getCorporation:         function (corpID) {
        if (!gHR._corporations)
            gHR.getAllCorporations({});
        return gHR._corporations['c'+corpID];
    },

    getCharacter:           function (charID) {
        if (!gHR._characters['c'+charID])
            gHR._characters['c'+charID] = new EveCharacter(charID);
        return gHR._characters['c'+charID];
    },
};

function _getCharFromStmRow(row) {
    if (!gHR._characters['c'+row.id])
        gHR._characters['c'+row.id] = new EveCharacter(stm.row.id);
    return gHR._characters['c'+row.id];
}

function hr_init() {
    if (!gHR._conn.tableExists('corporations'))
        gHR._conn.createTable('corporations',
            'name char, ticker char, id integer, ' +
            'alliance integer, primary key (id)');
    if (!gHR._conn.tableExists('characters'))
        gHR._conn.createTable('characters',
            'name char, id integer, account integer, ' +
            'corporation integer, primary key (id)');
    for each (var i in DataFactory)
        i.stm = gHR._conn.createStatement(i.query);
    gHR._getCorpListStm = gHR._conn.createStatement('select id from corporations;');
    gHR._getCharListStm = gHR._conn.createStatement('select id from characters;');
}

var components = [EveHRManager, EveCorporation, EveCharacter];

if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule(components);

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

