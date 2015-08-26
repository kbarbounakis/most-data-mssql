# most-data-mssql (in progress - separate adapter from most-data core)
Most Web Framework MSSQL Adapter
##Install
$ npm install most-data-mssql
##Usage
Register MSSQL adapter on app.json as follows:

    "adapterTypes": [
        ...
        { "name":"MSSQL Data Adapter", "invariantName": "mssql", "type":"most-data-mssql" }
        ...
    ],
    adapters: [
        ...
        { "name":"development", "invariantName":"mssql", "default":true,
            "options": {
              "host":"localhost",
              "port":1433,
              "user":"user",
              "password":"password",
              "database":"test"
            }
        }
        ...
    ]

If you are intended to use MSSQL data adapter as the default database adapter set the property "default" to true.
