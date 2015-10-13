/**
 * MOST Web Framework
 * A JavaScript Web Framework
 * http://themost.io
 *
 * Copyright (c) 2014, Kyriakos Barbounakis k.barbounakis@gmail.com, Anthi Oikonomou anthioikonomou@gmail.com
 *
 * Released under the BSD3-Clause license
 * Date: 2014-01-25
 */
var mssql = require('mssql'),
    async = require('async'),
    util = require('util'),
    qry = require('most-query');

/**
 * @class MSSqlAdapter
 * @constructor
 * @augments DataAdapter
 */
function MSSqlAdapter(options)
{
    /**
     * @private
     * @type {Connection}
     */
    this.rawConnection = null;
    /**
     * Gets or sets database connection string
     * @type {*}
     */
    this.options = options;
    /**
     * Gets or sets a boolean that indicates whether connection pooling is enabled or not.
     * @type {boolean}
     */
    this.connectionPooling = false;

    var self = this;
    /**
     * Gets connection string from options.
     * @type {string}
     */
    Object.defineProperty(this, 'connectionString', {
        get: function() {
            var keys = Object.keys(self.options);
            return keys.map(function(x) {
                return x.concat('=',self.options[x]);
            }).join(';');
        }, configurable:false, enumerable:false
    });
}

MSSqlAdapter.prototype.prepare = function(query,values)
{
    return qry.prepare(query,values);
};

/**
 * Opens database connection
 */
MSSqlAdapter.prototype.open = function(callback)
{
    callback = callback || function() {};
    var self = this;
    if (this.rawConnection) {
        callback.call(self);
        return;
    }

    self.rawConnection = new mssql.Connection(self.options);
    self.rawConnection.connect(function(err) {
        if (err) {
            self.rawConnection=null;
            console.log(err);
        }
        callback.call(self, err);
    });

}

MSSqlAdapter.prototype.close = function() {
    var self = this;
    if (!self.rawConnection)
        return;

    self.rawConnection.close(function (err) {
        if (err) {
            console.log(err);
            //do nothing
            self.rawConnection = null;
        }
    });
}
/**
 * Begins a data transaction and executes the given function
 * @param fn {Function}
 * @param callback {Function}
 */
MSSqlAdapter.prototype.executeInTransaction = function(fn, callback) {
    var self = this;
    //ensure callback
    callback = callback || function () {
    };

    //ensure that database connection is open
    self.open(function (err) {
        if (err) {
            callback.call(self, err);
            return;
        }
        //check if transaction is already defined (as object)
        if (self.transaction) {
            //so invoke method
            fn.call(self, function (err) {
                //call callback
                callback.call(self, err);
            });
        }
        else {
            //create transaction
            self.transaction = new mssql.Transaction(self.rawConnection);
            //begin transaction
            self.transaction.begin(function(err) {
                //error check (?)
                if (err) {
                    console.log(err);
                    callback.call(self, err);
                }
                else {
                    try {
                        fn.call(self, function (err) {
                            try {
                                if (err) {
                                    if (self.transaction) {
                                        self.transaction.rollback();
                                        self.transaction=null;
                                    }
                                    callback.call(self, err);
                                }
                                else {
                                    if (typeof self.transaction === 'undefined' || self.transaction === null) {
                                        callback.call(self, new Error('Database transaction cannot be empty on commit.'));
                                        return;
                                    }
                                    self.transaction.commit(function (err) {
                                        if (err) {
                                            self.transaction.rollback();
                                        }
                                        self.transaction = null;
                                        callback.call(self, err);
                                    });
                                }
                            }
                            catch (e) {
                                callback.call(self, e);
                            }
                        });
                    }
                    catch (e) {
                        callback.call(self, e);
                    }

                }
            });

           /* self.transaction.on('begin', function() {
                console.log('begin transaction');
            });*/



        }
    });
}

/**
 * Executes an operation against database and returns the results.
 * @param batch {DataModelBatch}
 * @param callback {Function}
 */
MSSqlAdapter.prototype.executeBatch = function(batch, callback) {
    callback = callback || function() {};
    callback(new Error('DataAdapter.executeBatch() is obsolete. Use DataAdapter.executeInTransaction() instead.'));
};

/**
 * Produces a new identity value for the given entity and attribute.
 * @param entity {String} The target entity name
 * @param attribute {String} The target attribute
 * @param callback {Function=}
 */
MSSqlAdapter.prototype.selectIdentity = function(entity, attribute , callback) {

    var self = this;

    var migration = {
        appliesTo:'increment_id',
        model:'increments',
        version:'1.0',
        description:'Increments migration (version 1.0)',
        add:[
            { name:'id', type:'Counter', primary:true },
            { name:'entity', type:'Text', size:120 },
            { name:'attribute', type:'Text', size:120 },
            { name:'value', type:'Integer' }
        ]
    }
    //ensure increments entity
    self.migrate(migration, function(err)
    {
        //throw error if any
        if (err) { callback.call(self,err); return; }

        self.execute('SELECT * FROM increment_id WHERE entity=? AND attribute=?', [entity, attribute], function(err, result) {
            if (err) { callback.call(self,err); return; }
            if (result.length==0) {
                //get max value by querying the given entity
                var q = qry.query(entity).select([qry.fields.max(attribute)]);
                self.execute(q,null, function(err, result) {
                    if (err) { callback.call(self, err); return; }
                    var value = 1;
                    if (result.length>0) {
                        value = parseInt(result[0][attribute]) + 1;
                    }
                    self.execute('INSERT INTO increment_id(entity, attribute, value) VALUES (?,?,?)',[entity, attribute, value], function(err) {
                        //throw error if any
                        if (err) { callback.call(self, err); return; }
                        //return new increment value
                        callback.call(self, err, value);
                    });
                });
            }
            else {
                //get new increment value
                var value = parseInt(result[0].value) + 1;
                self.execute('UPDATE increment_id SET value=? WHERE id=?',[value, result[0].id], function(err) {
                    //throw error if any
                    if (err) { callback.call(self, err); return; }
                    //return new increment value
                    callback.call(self, err, value);
                });
            }
        });
    });
};

/**
 * @param query {*}
 * @param values {*}
 * @param {function} callback
 */
MSSqlAdapter.prototype.execute = function(query, values, callback) {
    var self = this, sql = null;
    try {

        if (typeof query == 'string') {
            //get raw sql statement
            sql = query;
        }
        else {
            //format query expression or any object that may be act as query expression
            var formatter = new MSSqlFormatter();
            sql = formatter.format(query);
        }
        //validate sql statement
        if (typeof sql !== 'string') {
            callback.call(self, new Error('The executing command is of the wrong type or empty.'));
            return;
        }
        //ensure connection
        self.open(function(err) {
            if (err) {
                callback.call(self, err);
            }
            else {
                //log statement (optional)
                var startTime;
                if (process.env.NODE_ENV==='development') {
                    startTime = new Date().getTime();
                }
                //execute raw command
                var request = self.transaction ? new mssql.Request(self.transaction) : new mssql.Request(self.rawConnection);
                var preparedSql=self.prepare(sql , values);
                 if(typeof query.$insert!=='undefined')
                     preparedSql+= ';SELECT @@IDENTITY as insertId';
                request.query(preparedSql, function(err, result) {
                    if (process.env.NODE_ENV==='development') {
                        console.log(util.format('SQL (Execution Time:%sms):%s, Parameters:%s', (new Date()).getTime()-startTime, sql, JSON.stringify(values)));
                    }
                    if(typeof query.$insert==='undefined')
                        callback.call(self, err, result);
                    else {
                        if (result) {
                            if(result.length>0)
                                callback.call(self, err, { insertId:result[0].insertId });
                            else
                                callback.call(self, err, result);
                        }
                        else {
                            callback.call(self, err, result);
                        }
                    }
                });
            }
        });
    }
    catch (e) {
        callback.call(self, e);
    }

};
/**
 * Formats an object based on the format string provided. Valid formats are:
 * %t : Formats a field and returns field type definition
 * %f : Formats a field and returns field name
 * @param format {string}
 * @param obj {*}
 */
MSSqlAdapter.format = function(format, obj)
{
    var result = format;
    if (/%t/.test(format))
        result = result.replace(/%t/g,MSSqlAdapter.formatType(obj));
    if (/%f/.test(format))
        result = result.replace(/%f/g,obj.name);
    return result;
}

MSSqlAdapter.formatType = function(field)
{
    var size = parseInt(field.size);
    var scale = parseInt(field.scale);
    var s = 'varchar(512) NULL';
    var type=field.type;
    switch (type)
    {
        case 'Boolean':
            s = 'bit';
            break;
        case 'Byte':
            s = 'tinyint';
            break;
        case 'Number':
        case 'Float':
            s = 'float';
            break;
        case 'Counter':
            return 'int IDENTITY (1,1) NOT NULL';
        case 'Currency':
            s = size>0 ? (size<=10 ? 'smallmoney' : 'money') : 'money';
            break;
        case 'Decimal':
            s =  util.format('decimal(%s,%s)', (size>0 ? size : 19), (scale>0 ? scale : 4));
            break;
        case 'Date':
            s = 'date';
            break;
        case 'DateTime':
            s = 'datetimeoffset';
            break;
        case 'Time':
            s = 'time';
            break;
        case 'Integer':
        case 'Duration':
            s = 'int';
            break;
        case 'URL':
            if (size>0)
                s =  util.format('varchar(%s)', size);
            else
                s =  'varchar(512)';
            break;
        case 'Text':
            if (size>0)
                s =  util.format('varchar(%s)', size);
            else
                s =  'varchar(512)';
            break;
        case 'Note':
            if (size>0)
                s =  util.format('varchar(%s)', size);
            else
                s =  'text';
            break;
        case 'Image':
        case 'Binary':
            s ='binary';
            break;
        case 'Guid':
            s = 'varchar(36)';
            break;
        case 'Short':
            s = 'smallint';
            break;
        default:
            s = 'int';
            break;
    }
    s += field.nullable===undefined ? ' null': field.nullable ? ' null': ' not null';
    return s;
};
/**
 * @param {string} name
 * @param {QueryExpression} query
 * @param {Function} callback
 */
MSSqlAdapter.prototype.createView = function(name, query, callback) {
    return this.view(name).create(query, callback);
};
/**
 * Initializes database table helper.
 * @param {string} name - The table name
 * @returns {{exists: Function, version: Function, columns: Function, create: Function, add: Function, change: Function}}
 */
MSSqlAdapter.prototype.table = function(name) {
    var self = this, owner, table;
    var matches = /(\w+)\.(\w+)/.exec(name);
    if (matches) {
        //get schema owner
        owner = matches[1];
        //get table name
        table = matches[2];
    }
    else {
        //get view name
        table = name;
        //get default owner
        owner = 'dbo';
    }
    return {
        /**
         * @param {function(Error,Boolean=)} callback
         */
        exists:function(callback) {
            callback = callback || function() {};
            self.execute('SELECT COUNT(*) AS [count] FROM sysobjects WHERE [name]=? AND [type]=\'U\' AND SCHEMA_NAME([uid])=?',
                [ table, owner ], function(err, result) {
                    if (err) { return callback(err); }
                    callback(null, result[0].count);
                });
        },
        /**
         * @param {function(Error,string=)} callback
         */
        version:function(callback) {
            callback = callback || function() {};
            self.execute('SELECT MAX([version]) AS [version] FROM [migrations] WHERE [appliesTo]=?',
                [table], function(err, result) {
                    if (err) { return callback(err); }
                    if (result.length==0)
                        callback(null, '0.0');
                    else
                        callback(null, result[0].version || '0.0');
                });
        },
        /**
         * @param {function(Error=,Array=)} callback
         */
        columns:function(callback) {
            callback = callback || function() {};
            self.execute("SELECT c0.[name] AS [name], c0.[isnullable] AS [nullable], c0.[length] AS [size], c0.[prec] AS [precision], " +
                "c0.[scale] AS [scale], t0.[name] AS type, t0.[name] + CASE WHEN t0.[variable]=0 THEN '' ELSE '(' + CONVERT(varchar,c0.[length]) + ')' END AS [type1], " +
                "CASE WHEN p0.[indid]>0 THEN 1 ELSE 0 END [primary] FROM syscolumns c0  INNER JOIN systypes t0 ON c0.[xusertype] = t0.[xusertype] " +
                "INNER JOIN  sysobjects s0 ON c0.[id]=s0.[id]  LEFT JOIN (SELECT k0.* FROM sysindexkeys k0 INNER JOIN (SELECT i0.* FROM sysindexes i0 " +
                "INNER JOIN sysobjects s0 ON i0.[id]=s0.[id]  WHERE i0.[status]=2066) x0  ON k0.[id]=x0.[id] AND k0.[indid]=x0.[indid] ) p0 ON c0.[id]=p0.[id] " +
                "AND c0.[colid]=p0.[colid]  WHERE s0.[name]=? AND s0.[xtype]='U' AND SCHEMA_NAME(s0.[uid])=?",
                [ table, owner ], function(err, result) {
                    if (err) { return callback(err); }
                    callback(null, result);
                });
        },
        /**
         * @param {{name:string,type:string,primary:boolean|number,nullable:boolean|number,size:number, scale:number,precision:number,oneToMany:boolean}[]|*} fields
         * @param callback
         */
        create: function(fields, callback) {
            callback = callback || function() {};
            fields = fields || [];
            if (!util.isArray(fields)) {
                return callback(new Error('Invalid argument type. Expected Array.'))
            }
            if (fields.length == 0) {
                return callback(new Error('Invalid argument. Fields collection cannot be empty.'))
            }
            var strFields = fields.filter(function(x) {
                return !x.oneToMany;
            }).map(
                function(x) {
                    return MSSqlAdapter.format('[%f] %t', x);
                }).join(', ');
            //add primary key constraint
            var strPKFields = fields.filter(function(x) { return (x.primary == true || x.primary == 1); }).map(function(x) {
                return MSSqlAdapter.format('[%f]', x);
            }).join(', ');
            if (strPKFields.length>0) {
                strFields += ', ' + util.format('PRIMARY KEY (%s)', strPKFields);
            }
            var strTable = util.format('[%s].[%s]', owner, table);
            var sql = util.format('CREATE TABLE %s (%s)', strTable, strFields);
            self.execute(sql, null, function(err) {
                callback(err);
            });
        },
        /**
         * Alters the table by adding an array of fields
         * @param {{name:string,type:string,primary:boolean|number,nullable:boolean|number,size:number,oneToMany:boolean}[]|*} fields
         * @param callback
         */
        add:function(fields, callback) {
            callback = callback || function() {};
            callback = callback || function() {};
            fields = fields || [];
            if (!util.isArray(fields)) {
                //invalid argument exception
                return callback(new Error('Invalid argument type. Expected Array.'))
            }
            if (fields.length == 0) {
                //do nothing
                return callback();
            }
            var strTable = util.format('[%s].[%s]', owner, table);
            //generate SQL statement
            var sql = fields.map(function(x) {
                return MSSqlAdapter.format('ALTER TABLE ' + strTable + ' ADD [%f] %t', x);
            }).join(';');
            self.execute(sql, [], function(err) {
                callback(err);
            });
        },
        /**
         * Alters the table by modifying an array of fields
         * @param {{name:string,type:string,primary:boolean|number,nullable:boolean|number,size:number,oneToMany:boolean}[]|*} fields
         * @param callback
         */
        change:function(fields, callback) {
            callback = callback || function() {};
            callback = callback || function() {};
            fields = fields || [];
            if (!util.isArray(fields)) {
                //invalid argument exception
                return callback(new Error('Invalid argument type. Expected Array.'))
            }
            if (fields.length == 0) {
                //do nothing
                return callback();
            }
            var strTable = util.format('[%s].[%s]', owner, table);
            //generate SQL statement
            var sql = fields.map(function(x) {
                return MSSqlAdapter.format('ALTER TABLE ' + strTable + ' ALTER COLUMN [%f] %t', x);
            }).join(';');
            self.execute(sql, [], function(err) {
                callback(err);
            });
        }
    }
};
/**
 * Initializes database view helper.
 * @param {string} name - A string that represents the view name
 * @returns {{exists: Function, drop: Function, create: Function}}
 */
MSSqlAdapter.prototype.view = function(name) {
    var self = this, owner, view;
    var matches = /(\w+)\.(\w+)/.exec(name);
    if (matches) {
        //get schema owner
        owner = matches[1];
        //get table name
        view = matches[2];
    }
    else {
        //get view name
        view = name;
        //get default owner
        owner = 'dbo';
    }
    return {
        /**
         * @param {function(Error,Boolean=)} callback
         */
        exists:function(callback) {
            callback = callback || function() {};
            self.execute('SELECT COUNT(*) AS [count] FROM sysobjects WHERE [name]=? AND [type]=\'V\' AND SCHEMA_NAME([uid])=?',
                [ view, owner ], function(err, result) {
                    if (err) { return callback(err); }
                    callback(null, result[0].count);
                });
        },
        /**
         * @param {function(Error=)} callback
         */
        drop:function(callback) {
            callback = callback || function() {};
            self.open(function(err) {
                if (err) { return callback(err); }
                self.execute('SELECT COUNT(*) AS [count] FROM sysobjects WHERE [name]=? AND [type]=\'V\' AND SCHEMA_NAME([uid])=?',
                    [view, owner], function(err, result) {
                    if (err) { return callback(err); }
                    var exists = (result[0].count>0);
                    if (exists) {
                        var formatter = new MSSqlFormatter();
                        var sql = util.format('DROP VIEW %s.%s',formatter.escapeName(owner), formatter.escapeName(view));
                        self.execute(sql, [], function(err) {
                            if (err) { callback(err); return; }
                            callback();
                        });
                    }
                    else {
                        callback();
                    }
                });
            });
        },
        /**
         * @param {QueryExpression|*} q
         * @param {function(Error=)} callback
         */
        create:function(q, callback) {
            var thisArg = this;
            self.executeInTransaction(function(tr) {
                thisArg.drop(function(err) {
                    if (err) { tr(err); return; }
                    try {
                        var formatter = new MSSqlFormatter();
                        var sql = "EXECUTE('" + util.format('CREATE VIEW %s.%s AS ',formatter.escapeName(owner), formatter.escapeName(view)) + formatter.format(q) + "')";
                        self.execute(sql, [], tr);
                    }
                    catch(e) {
                        tr(e);
                    }
                });
            }, function(err) {
                callback(err);
            });

        }
    };
};
/**
 *
 * @param  {DataModelMigration|*} obj - An Object that represents the data model scheme we want to migrate
 * @param {function(Error=,*=)} callback
 */
MSSqlAdapter.prototype.migrate = function(obj, callback) {
    if (obj==null)
        return;
    var self = this;
    var migration = obj;
    if (typeof migration.appliesTo === 'undefined' || migration.appliesTo==null)
        throw new Error("Invalid argument. Model name is undefined.");
    self.open(function(err) {
        if (err) {
            callback.call(self, err);
        }
        else {
            async.waterfall([
                //1. Check migrations table existence
                function(cb) {
                    self.table('migrations').exists(function(err, exists) {
                        if (err) { return cb(err); }
                        cb(null, exists);
                    });
                },
                //2. Create migrations table if not exists
                function(arg, cb) {
                    if (arg>0) { return cb(null, 0); }
                    self.table('migrations').create([
                        { name:'id', type:'Counter', primary:true, nullable:false  },
                        { name:'appliesTo', type:'Text', size:'80', nullable:false  },
                        { name:'model', type:'Text', size:'120', nullable:true  },
                        { name:'description', type:'Text', size:'512', nullable:true  },
                        { name:'version', type:'Text', size:'40', nullable:false  }
                    ], function(err) {
                        if (err) { return cb(err); }
                        cb(null,0);
                    });
                },
                //3. Check if migration has already been applied
                function(arg, cb) {
                    self.execute('SELECT COUNT(*) AS [count] FROM [migrations] WHERE [appliesTo]=? and [version]=?',
                        [migration.appliesTo, migration.version], function(err, result) {
                            if (err) { return cb(err); }
                            cb(null, result[0].count);
                        });
                },
                //4a. Check table existence
                function(arg, cb) {
                    //migration has already been applied (set migration.updated=true)
                    if (arg>0) { obj['updated']=true; cb(null, -1); return; }
                    self.table(migration.appliesTo).exists(function(err, exists) {
                        if (err) { return cb(err); }
                        cb(null, exists);
                    });
                },
                //4b. Migrate target table (create or alter)
                function(arg, cb) {
                    //migration has already been applied
                    if (arg<0) { return cb(null, arg); }
                    if (arg==0) {
                        //create table
                        return self.table(migration.appliesTo).create(migration.add, function(err) {
                            if (err) { return cb(err); }
                            cb(null, 1);
                        });
                    }
                    //columns to be removed (unsupported)
                    if (util.isArray(migration.remove)) {
                        if (migration.remove.length>0) {
                            return cb(new Error('Data migration remove operation is not supported by this adapter.'));
                        }
                    }
                    //columns to be changed (unsupported)
                    if (util.isArray(migration.change)) {
                        if (migration.change.length>0) {
                            return cb(new Error('Data migration change operation is not supported by this adapter. Use add collection instead.'));
                        }
                    }
                    var column, newType, oldType;
                    if (util.isArray(migration.add)) {
                        //init change collection
                        migration.change = [];
                        //get table columns
                        self.table(migration.appliesTo).columns(function(err, columns) {
                            if (err) { return cb(err); }
                            for (var i = 0; i < migration.add.length; i++) {
                                var x = migration.add[i];
                                column = columns.find(function(y) { return (y.name===x.name); });
                                if (column) {
                                    //if column is primary key remove it from collection
                                    if (column.primary) {
                                        migration.add.splice(i, 1);
                                        i-=1;
                                    }
                                    else {
                                        //get new type
                                        newType = MySqlAdapter.format('%t', x);
                                        //get old type
                                        oldType = column.type1.replace(/\s+$/,'') + ((column.nullable==true || column.nullable == 1) ? ' null' : ' not null');
                                        //remove column from collection
                                        migration.add.splice(i, 1);
                                        i-=1;
                                        if (newType !== oldType) {
                                            //add column to alter collection
                                            migration.change.push(x);
                                        }
                                    }
                                }
                            }
                            //alter table
                            var targetTable = self.table(migration.appliesTo);
                            //add new columns (if any)
                            targetTable.add(migration.add, function(err) {
                                if (err) { return cb(err); }
                                //modify columns (if any)
                                targetTable.change(migration.change, function(err) {
                                    if (err) { return cb(err); }
                                    cb(null, 1);
                                });
                            });
                        });
                    }
                    else {
                        cb(new Error('Invalid migration data.'));
                    }
                }, function(arg, cb) {
                    if (arg>0) {
                        self.execute('INSERT INTO migrations (appliesTo,model,version,description) VALUES (?,?,?,?)', [migration.appliesTo,
                            migration.model,
                            migration.version,
                            migration.description ], function(err) {
                            if (err) { return cb(err); }
                            return cb(null, 1);
                        });
                    }
                    else
                        cb(null, arg);
                }
            ], function(err, result) {
                callback(err, result);
            });
        }
    });
};

MSSqlAdapter.queryFormat = function (query, values) {
    if (!values) return query;
    return query.replace(/:(\w+)/g, function (txt, key) {
        if (values.hasOwnProperty(key)) {
            return this.escape(values[key]);
        }
        return txt;
    }.bind(this));
};


function zeroPad(number, length) {
    number = number || 0;
    var res = number.toString();
    while (res.length < length) {
        res = '0' + res;
    }
    return res;
}

/**
 * @class MSSqlFormatter
 * @constructor
 * @augments {SqlFormatter}
 */
function MSSqlFormatter() {
    this.settings = {
        nameFormat:'[$1]'
    }
}
util.inherits(MSSqlFormatter, qry.classes.SqlFormatter);

MSSqlFormatter.prototype.formatLimitSelect = function(obj) {

    var sql, self=this;
    if (!obj.$take) {
        sql=this.formatSelect(obj);
    }
    else {
        obj.$take= parseInt(obj.$take) || 0;
        obj.$skip= parseInt(obj.$skip) || 0;
        //add row_number with order
        var keys = Object.keys(obj.$select);
        if (keys.length == 0)
            throw new Error('Entity is missing');
        var qfields = obj.$select[keys[0]], order =obj.$order;
        qfields.push(util.format('ROW_NUMBER() OVER(%s) AS __RowIndex', order ? self.format(order, '%o') : 'ORDER BY (SELECT NULL)'));
        if (order)
            delete obj.$order;
        var subQuery = self.formatSelect(obj);
        if (order)
            obj.$order = order;
        //delete row index field
        qfields.pop();
        var fields = [];
        qfields.forEach(function (x) {
            if (typeof x === 'string') {
                fields.push(new qry.classes.QueryField(x));
            }
            else {
                var field = util._extend(new qry.classes.QueryField(), x);
                fields.push(field.as() || field.name());
            }
        });
        sql = util.format('SELECT %s FROM (%s) t0 WHERE __RowIndex BETWEEN %s AND %s', fields.map(function (x) {
            return self.format(x, '%f');
        }).join(', '), subQuery, obj.$skip + 1, obj.$skip + obj.$take);
    }
    return sql;
};

/**
 * Implements indexOf(str,substr) expression formatter.
 * @param {String} p0 The source string
 * @param {String} p1 The string to search for
 */
MSSqlFormatter.prototype.$indexof = function(p0, p1)
{
    p1='%'+ p1+ '%';
    return 'PATINDEX('.concat( this.escape(p1),',',this.escape(p0),')');
};

/**
 * Implements indexOf(str,substr) expression formatter.
 * @param {string|*} p0 The source string or field
 * @param {string|*} p1 The string to search for
 */
MSSqlFormatter.prototype.$text = function(p0, p1)
{
    return 'PATINDEX('.concat(this.escape('%' + p1 + '%s'),',',this.escape(p0),') >= 1');
};

MSSqlFormatter.prototype.$date = function(p0) {
    //TODO:: check date type
    return util.format(' TODATETIMEOFFSET (%s,datepart(TZ,SYSDATETIMEOFFSET()))', this.escape(p0));
};

/**
 * Escapes an object or a value and returns the equivalen sql value.
 * @param {*} value
 * @param {boolean=} unquoted
 */
MSSqlFormatter.prototype.escape = function(value,unquoted)
{
    if (value==null || typeof value==='undefined')
        return qry.escape(null);

    if(typeof value==='string')
        return '\'' + value.replace(/'/g, "''") + '\'';

    if (typeof value==='boolean')
        return value ? 1 : 0;
    if (typeof value === 'object')
    {
        //add an exception for Date object
        if (value instanceof Date)
            return this.escapeDate(value);
        if (value.hasOwnProperty('$name'))
            return value.$name;
    }
    if (unquoted)
        return value.valueOf();
    else
        return qry.escape(value);
};

/**
 * @param {Date|*} val
 * @returns {string}
 */
MSSqlFormatter.prototype.escapeDate = function(val) {
    var year   = val.getFullYear();
    var month  = zeroPad(val.getMonth() + 1, 2);
    var day    = zeroPad(val.getDate(), 2);
    var hour   = zeroPad(val.getHours(), 2);
    var minute = zeroPad(val.getMinutes(), 2);
    var second = zeroPad(val.getSeconds(), 2);
    var millisecond = zeroPad(val.getMilliseconds(), 3);
    //format timezone
    var offset = val.getTimezoneOffset(),
        timezone = (offset<=0 ? '+' : '-') + zeroPad(-Math.floor(offset/60),2) + ':' + zeroPad(offset%60,2);
    return "CONVERT(datetimeoffset,'" + year + '-' + month + '-' + day + ' ' + hour + ':' + minute + ':' + second + "." + millisecond + timezone + "')";
};


/**
 * Implements startsWith(a,b) expression formatter.
 * @param p0 {*}
 * @param p1 {*}
 */
MSSqlFormatter.prototype.$startswith = function(p0, p1)
{
    p1='%' +p1 + '%';
    return util.format('PATINDEX (%s,%s)', this.escape(p1), this.escape(p0));
};

/**
 * Implements contains(a,b) expression formatter.
 * @param p0 {*}
 * @param p1 {*}
 */
MSSqlFormatter.prototype.$text = function(p0, p1)
{
    return util.format('PATINDEX (%s,%s) >= 1', this.escape('%' + p1 + '%s'), this.escape(p0));
};

/**
 * Implements endsWith(a,b) expression formatter.
 * @param p0 {*}
 * @param p1 {*}
 */
MSSqlFormatter.prototype.$endswith = function(p0, p1)
{
    p1='%' +p1;
    // (PATINDEX('%S%',  UserData.alternateName))
    return util.format('(CASE WHEN %s LIKE %s THEN 1 ELSE 0 END)', this.escape(p0), this.escape(p1));
};


/**
 * Implements substring(str,pos) expression formatter.
 * @param {String} p0 The source string
 * @param {Number} pos The starting position
 * @param {Number=} length The length of the resulted string
 * @returns {string}
 */
MSSqlFormatter.prototype.$substring = function(p0, pos, length)
{
    if (length)
        return util.format('SUBSTRING(%s,%s,%s)', this.escape(p0), pos.valueOf()+1, length.valueOf());
    else
        return util.format('SUBSTRING(%s,%s,%s)', this.escape(p0), pos.valueOf()+1,255);
};

/**
 * Implements trim(a) expression formatter.
 * @param p0 {*}
 */
MSSqlFormatter.prototype.$trim = function(p0)
{
    return util.format('LTRIM(RTRIM((%s)))', this.escape(p0));
};

if (typeof exports !== 'undefined')
{
    module.exports = {
        /**
         * @class MSSqlAdapter
         * */
        MSSqlAdapter : MSSqlAdapter,
        /**
         * @class MSSqlFormatter
         * */
        MSSqlFormatter : MSSqlFormatter,
        /**
         * Creates an instance of MSSqlAdapter object that represents a MsSql database connection.
         * @param options An object that represents the properties of the underlying database connection.
         * @returns {DataAdapter}
         */
        createInstance: function(options) {
            return new MSSqlAdapter(options);
        },
        /**
         * Formats the query command by using the object provided e.g. SELECT * FROM Table1 WHERE id=:id
         * @param query {string}
         * @param values {*}
         */
        queryFormat: function(query, values) {
            return MSSqlAdapter.queryFormat(query, values);
        }

    }
}