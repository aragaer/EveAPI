const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

const obs = Services.obs;

function dbwrapper() { }

dbwrapper.prototype = {
    classDescription:   "EVE Online static dump",
    classID:            Components.ID("{66575bef-61c0-4ea3-9c34-17c10870e6a9}"),
    contractID:         "@aragaer/eve/db;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveDBService, Ci.nsIObserver]),
    _xpcom_categories: [{
        category:       'app-startup',
        entry:          '@aragaer/eve/db;1',
        service:        true,
    }],

    _conn:              null,

    getConnection:      function () {dump("conn requested: "+this._conn+"\n"); return this._conn; },
    createStatement:    function (q) this._conn.createStatement(q),

    observe:            function (aSubject, aTopic, aData) {
        switch (aTopic) {
        case 'app-startup':
            obs.addObserver(this, 'profile-after-change', false);
            obs.addObserver(this, 'quit-application', false);
            break;
        case 'profile-after-change':
            this._init();
            obs.notifyObservers(this._conn, 'eve-db-init', null);
            break;
        case 'quit-application':
            obs.removeObserver(this, 'profile-after-change');
            obs.removeObserver(this, 'quit-application');
        }
    },

    _init:              function () {
        var file = Cc["@mozilla.org/file/directory_service;1"].
                getService(Ci.nsIProperties).get('ProfD', Ci.nsIFile);
        file.append('data');
        if (!file.exists())
            file.create(file.DIRECTORY_TYPE, 0777);
 
        file.append('api.db');
        if (!file.exists())
            file.create(file.NORMAL_FILE_TYPE, 0700);

        if (this._conn)
            this._conn.close();

        this._conn = Cc["@mozilla.org/storage/service;1"].
                getService(Ci.mozIStorageService).
                openDatabase(file);

        this._initLocalDB();

        try {
            this._openStaticDB();
            dump("Static DB initialized\n");
        } catch (e) {
            dump(e.toString()+"\n");
            dump(this._conn.lastErrorString+"\n");
        }

        dump("DB service initialized\n");
    },

    _initLocalDB:       function () {
        this._conn.executeSimpleSQL("PRAGMA synchronous = OFF");
        this._conn.executeSimpleSQL("PRAGMA temp_store = MEMORY");
        if (!this._conn.tableExists('characters'))
            this._conn.createTable('characters',
                    'name char, id integer, account integer, ' +
                    'corporation integer, primary key (id)');
        if (!this._conn.tableExists('corporations'))
            this._conn.createTable('corporations',
                    'name char, ticker char, id integer, ' +
                    'alliance integer, primary key (id)');
    },

    _openStaticDB:      function () {
        var static = Cc["@mozilla.org/preferences-service;1"].
            getService(Ci.nsIPrefBranch).getCharPref("eve.static_dump_path");
        dump(static+"\n");
        this._conn.executeSimpleSQL("attach database '"+static+"' as static\n")
    },
}

var components = [dbwrapper];

var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);

