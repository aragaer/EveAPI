const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function extend(to, from) {
    for (i in from) {
        var g = to.__lookupGetter__(i), s = to.__lookupSetter__(i);
        if (g || s || to[i])
            continue; // Do not overwrite

        g = from.__lookupGetter__(i), s = from.__lookupSetter__(i);
        if (g || s) {
            if (g)
                to.__defineGetter__(i, g);
            if (s)
                to.__defineSetter__(i, s);
        } else
            to[i] = from[i];
    }
}

var gOS, gDB, gEIS, gEAR;
const CTM = {};
const DataStatements = {
    getFuelReqs:    "select resourceTypeID, purpose, quantity " +
            "from static.invControlTowerResources " +
            "where controlTowerTypeID=:type_id and factionID is null;",
    getAddFuelReqs: "select resourceTypeID, purpose, quantity " +
            "from static.mapSolarSystems as sys " +
            "left join static.mapRegions as reg on sys.regionID = reg.regionID " +
            "left join static.invControlTowerResources as res on res.factionID=reg.factionID " +
                "and res.minSecurityLevel<sys.security " +
            "where controlTowerTypeID=:type_id " +
            "and sys.solarSystemID=:sys_id",
    getGridCPU:     "select a11.valueInt as grid, a48.valueInt as cpu " +
            "from static.invTypes as t " +
            "left join static.dgmTypeAttributes as a48 on t.typeID = a48.typeID " +
            "left join static.dgmTypeAttributes as a11 on t.typeID = a11.typeID " +
            "where t.typeID=:type_id " +
            "and a11.attributeID=11 and a48.attributeID=48;",
    getGridCPUUsage:"select sum(a30.valueInt) as grid, sum(a50.valueInt) as cpu " +
            "from starbaseConfig as lsc " +
            "left join dgmTypeAttributes as a30 on lsc.itemType = a30.typeID " +
            "left join dgmTypeAttributes as a50 on lsc.itemType = a50.typeID " +
            "where lsc.starbaseID=:id " +
            "and a30.attributeID=30 and a50.attributeID=50;",
    getPOSData:     "select state, moonID, onlineStamp, stateStamp, itemName from starbases " +
            "left join mapDenormalize on starbases.moonID=mapDenormalize.itemID " +
            "where starbaseID=:id;",
    addStructure:   "replace into starbaseConfig (itemID, starbaseID, isOnline, itemType) " +
            "values (:itemID, :starbaseID, :isOnline, :itemType);",
    removeStructure:"delete from starbaseConfig where itemID=:itemID and starbaseID=:starbaseID;",
    getStructures:  "select itemID from starbaseConfig where starbaseID=:starbaseID;",
};

function StmName(FuncName) "_"+FuncName+"Stm";

function fueltype(itemtype, purpose, towertype, usage) {
    this._type = itemtype;
    this._purpose = +purpose;
    this._towertype = towertype;
    this._usage = +usage;
}

fueltype.prototype = {
    classDescriptopn:   "EVE Control tower fuel",
    classID:            Components.ID("{1a99a0bf-3f0f-4edc-a79d-404c0ce7f5c0}"),
    contractID:         "@aragaer/eve/control-tower-fuel-type;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveFuelType]),

    get type()          this._type,
    get purpose()       this._purpose,
    get towertype()     this._towertype,
    get consumption()   this._usage,
    toString:           function () this._type.name,
};

function posfuel(type, count, tower) {
    this._type = type;
    this._count = count;
    this._tower = tower;
    this._tt = tower.type.QueryInterface(Ci.nsIEveControlTowerType);
}
posfuel.prototype = {
    classDescriptopn:   "EVE Control tower fuel item",
    classID:            Components.ID("{fecf0883-57fb-4974-a169-7a9be88cc6a7}"),
    contractID:         "@aragaer/eve/control-tower-fuel;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveFuel]),

    get type()      this._type,
    get count()     this._count,
    get realConsumption() {
        var factor = 1;
        switch(this._type.purpose) {
        case Ci.nsEveFuelPurpose.PURPOSE_POWER:
            factor = this._tower.powerUsage/this._tt.powerGrid;
            break;
        case Ci.nsEveFuelPurpose.PURPOSE_CPU:
            factor = this._tower.CPUUsage/this._tt.CPU;
            break;
        case Ci.nsEveFuelPurpose.PURPOSE_ONLINE:
        default:
            factor = 1;
            break;
        }
        return Math.round(this._type.consumption*factor);
    },
    toString:       function () this._type.type.name,
    hoursLeft:      function () {
        var c = this.realConsumption;
        return c
            ? Math.floor(this._count/c)
            : -1;
    },
};

function controltower(itemid) {
    let stm = CTM._getPOSDataStm;
    stm.params.id = itemid;
    try {
        if (stm.step()) {
            this._state = stm.row.state;
            this._moonID = stm.row.moonID;
            this._onlineStamp = Date.UTCFromEveTimeString(stm.row.onlineStamp)/1000;
            this._stateStamp = Date.UTCFromEveTimeString(stm.row.stateStamp)/1000;
            this._moonName = stm.row.itemName;
        }
    } catch (e) {
        dump(e.toString()+"\n");
    } finally {
        stm.reset();
    }
}

controltower.prototype = {
    idn:                'nsIEveControlTower',
    test:               function (obj, data)
            obj._type.group.id == Ci.nsEveItemGroupID.GROUP_CONTROL_TOWER
            && obj._container == null,
    extend:             function (obj, data) {
        extend(obj, new controltower(obj._id));
        obj._refreshGridCPU();
    },

    _refreshGridCPU:    function () {
        let stm = CTM._getGridCPUUsageStm;
        stm.params.id = this._id;
        try {
            stm.executeStep();
            this._powerUsage = stm.row.grid;
            this._CPUUsage = stm.row.cpu;
        } catch (e) {
            dump("Refresh grid cpu: "+e+"\n");
        } finally {
            stm.reset();
        }
    },
    get powerUsage()    this._powerUsage,
    get CPUUsage()      this._CPUUsage,
    get state()         this._state,
    get moonID()        this._moonID,
    get onlineStamp()   this._onlineStamp,
    get stateStamp()    this._stateStamp,
    get moonName()      this._moonName,
    getFuel:            function (out) {
        var fuel = {};
        var reqs = this._type.getFuelRequirements({}).
                concat(this._type.getFuelForSystem(this._location, {}));

        this._fillChilds();
        for each (i in this._childs)
            fuel['f'+i.type.id] = i.quantity;

        var res = [new posfuel(r, fuel['f'+r._type.id] || 0, this) for each (r in reqs)];
        out.value = res.length;
        return res;
    },

    addStructure:       function (itm) {
        let stm = CTM._addStructureStm;
        stm.params.itemID = itm.id;
        stm.params.itemType = itm.type.id;
        stm.params.isOnline = true;
        stm.params.starbaseID = this._id;
        stm.execute();
        this._refreshGridCPU();
    },

    removeStructure:    function (itm) {
        let stm = CTM._removeStructureStm;
        stm.params.itemID = itm.id;
        stm.params.starbaseID = this._id;
        stm.execute();
        this._refreshGridCPU();
    },

    getAllStructuresAsync:  function (handler) {
        let stm = CTM._getStructuresStm;
        stm.params.starbaseID = this._id;
        stm.executeAsync({
            handleError:        handler.onError,
            handleCompletion:   handler.onCompletion,
            handleResult:       function (r) {
                while (row = r.getNextRow())
                handler.onItem(gEIS.createItem('fromID', row.getResultByName('itemID')));
            }
        });
    },
};

function controltowertype(typeid) {
    let stm = CTM._getGridCPUStm;
    stm.params.type_id = typeid;
    try {
        stm.executeStep();
        this._powerGrid = stm.row.grid;
        this._CPU = stm.row.cpu;
    } catch (e) {
        dump(e.toString()+"\n");
    } finally {
        stm.reset();
    }
}

controltowertype.prototype = {
    idn:                'nsIEveControlTowerType',
    test:               function (type)
            type._group.id == Ci.nsEveItemGroupID.GROUP_CONTROL_TOWER,
    extend:             function (type) {
        extend(type, new controltowertype(type._id));
    },
    _getFuelListFromStm:    function (stm) {
        var res = [];
        try {
            while (stm.executeStep())
                res.push(new fueltype(
                    gEIS.getItemType(stm.row.resourceTypeID),
                    stm.row.purpose,
                    this,
                    stm.row.quantity
                ));
        } catch (e) {
            dump(e.toString()+"\n");
        } finally {
            stm.reset();
        }
        return res;
    },
    getFuelRequirements:    function (out) {
        let stm = CTM._getFuelReqsStm;
        stm.params.type_id = this._id;
        var res = this._getFuelListFromStm(stm);
        out.value = res.length;
        return res;
    },
    getFuelForSystem:       function (sys, out) {
        let stm = CTM._getAddFuelReqsStm;
        stm.params.sys_id = sys;
        stm.params.type_id = this._id;
        var res = this._getFuelListFromStm(stm);
        out.value = res.length;
        return res;
    },
    get powerGrid()     this._powerGrid,
    get CPU()           this._CPU,
};

function ControlTowerManager() {
    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    gDB = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
    gEIS = Cc["@aragaer/eve/inventory;1"].getService(Ci.nsIEveInventoryService);
    gEAR = Cc["@aragaer/eve/api-requester;1"].getService(Ci.nsIEveApiRequester);
}

ControlTowerManager.prototype = {
    classDescription:   "EVE Control Tower helper service",
    classID:            Components.ID("{7c7d6e9c-48b5-4eb2-99f2-445c3f0a2125}"),
    contractID:         "@aragaer/eve/control-tower/helper;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIObserver]),
    _xpcom_categories:  [{
        category:   "app-startup",
        service:    true
    }],

    observe:            function (aSubject, aTopic, aData) {
        switch (aTopic) {
        case 'app-startup':
            gOS.addObserver(this, 'eve-data', false);
            gOS.addObserver(this, 'eve-db-init', false);
            gEIS.addQI('item', {wrappedJSObject: controltower.prototype});
            gEIS.addQI('type', {wrappedJSObject: controltowertype.prototype});
            break;
        case 'eve-data':
            switch (aData) {
            case 'corptowers':
                break;
            case 'towerdetails':
                break;
            default:
                break;
            }
            break;
        case 'eve-db-init':
            this._conn = gDB.getConnection();
            if (!this._conn.tableExists('starbaseConfig'))
                this._conn.createTable('starbaseConfig',
                    'itemID integer, starbaseID integer, isOnline integer, ' +
                    'itemType integer, primary key (itemID)');
            if (!this._conn.tableExists('starbases'))
                this._conn.createTable('starbases',
                    'starbaseID integer, state integer, moonID integer, ' +
                    'itemType integer, onlineStamp char, stateStamp char, ' +
                    'primary key (starbaseID)');

            for (i in DataStatements)
                try {
                    CTM[StmName(i)] = this._conn.createStatement(DataStatements[i]);
                } catch (e) {
                    dump("Error in "+DataStatements[i]+"\n"+this._conn.lastErrorString+"\n");
                }
            break;
        }
    },
};

var components = [ControlTowerManager, fueltype];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}

Date.UTCFromEveTimeString = function (str) {
    var d = str.split(/:| |-/);
    d[1]--; // Month

    return Date.UTC(d[0], d[1], d[2], d[3], d[4], d[5]);
}

