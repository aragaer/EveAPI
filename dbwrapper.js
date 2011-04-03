const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

const obs = Services.obs;

var gDB;
function dbwrapper() {
    if (!gDB)
        gDB = this;
}

dbwrapper.prototype = {
    classDescription:   "EVE Online static dump",
    classID:            Components.ID("{66575bef-61c0-4ea3-9c34-17c10870e6a9}"),
    contractID:         "@aragaer/eve/db;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveDBService, Ci.nsIObserver]),

    getConnection:      function () gDB._conn,
    createStatement:    function (q) gDB._conn.createStatement(q),

    observe:            function (aSubject, aTopic, aData) {
        switch (aTopic) {
        case 'app-startup':
            obs.addObserver(this, 'profile-after-change', false);
            obs.addObserver(this, 'quit-application', false);
            break;
        case 'profile-after-change':
            var res = init();
            obs.notifyObservers(gDB._conn, res ? 'eve-db-init' : 'eve-db-error', null);
            break;
        case 'quit-application':
            obs.removeObserver(this, 'profile-after-change');
            obs.removeObserver(this, 'quit-application');
        }
    }
}

var components = [dbwrapper];

var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);

function init() {
    var file = Services.dirsvc.get('ProfD', Ci.nsIFile);
    file.append('data');
    if (!file.exists())
        file.create(file.DIRECTORY_TYPE, 0777);

    file.append('api.db');
    if (!file.exists())
        file.create(file.NORMAL_FILE_TYPE, 0700);

    if (gDB._conn)
        gDB._conn.close();

    try {
        gDB._conn = Services.storage.openDatabase(file);
        dump("DB file "+file.path+" opened\n");
        initLocalDB();
        dump("Initalization done\n");
        openStaticDB();
        dump("Static DB initialized\n");
    } catch (e) {
        dump(e.toString()+"\n");
        dump(gDB._conn.lastErrorString+"\n");
        return false;
    }

    return true;
}

function initLocalDB() {
    gDB._conn.executeSimpleSQL("PRAGMA synchronous = OFF");
    gDB._conn.executeSimpleSQL("PRAGMA temp_store = MEMORY");
}

function openStaticDB() {
    var static = Services.prefs.getCharPref("eve.static_dump_path");
    dump(static+"\n");
    gDB._conn.executeSimpleSQL("attach database '"+static+"' as static\n")
}

