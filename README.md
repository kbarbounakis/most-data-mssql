# most-data-mssql
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
              "server":"localhost",
              "user":"user",
              "password":"password",
              "database":"test"
            }
        }
        ...
    ]

If you are intended to use MSSQL data adapter as the default database adapter set the property "default" to true.
