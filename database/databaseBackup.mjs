import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const DEFAULT_EXCLUDED_SCHEMAS = [
    "backup", // all information about backup
    "graphile_worker", "postgraphile_watch", // postgraphile schemas
    "pg_toast", "pg_catalog", "information_schema", // postgresql system schemas
    "openbamz" // bamz metadata
] ;

let contextOfApp = null;

export function initDatabaseBackup({appContext}) {
    contextOfApp = appContext ;
}

async function getExcludedSchema(appName){
    let appContext = await contextOfApp(appName) ;
    return DEFAULT_EXCLUDED_SCHEMAS.concat(appContext.pluginsData["open-bamz-backup"]?.pluginSlots?.backupDatabaseExcludeSchemas??[])
}


export async function backupDatabase({backup, appName, query}) {
    const backupDir = path.join(process.env.DATA_DIR, "backups", appName);
    const filePath = path.join(backup.type, backup._id, `backup_db_${appName}_${new Date().toISOString().replace(/[T:.]/g, "-")}.sql`) ;
    const backupDataPath = path.join(backupDir, filePath) ;
    await mkdir(path.dirname(backupDataPath), { recursive: true });


    const listRoles = await query(`SELECT rolname FROM pg_catalog.pg_roles WHERE rolname ilike $1`, [appName+"_%"]) ;
    let sqlCreateRoles = "" ;
    for(let role of listRoles.rows){
        sqlCreateRoles += 
`
DO
$do$
BEGIN
   IF EXISTS (
      SELECT FROM pg_catalog.pg_roles
      WHERE  rolname = '${role.rolname}') THEN

      RAISE NOTICE 'Role "${role.rolname}" already exists. Skipping.';
   ELSE
      CREATE ROLE ${role.rolname} NOLOGIN;
   END IF;
END
$do$;
`
    }

    // create the backup file with role creation
    await writeFile(backupDataPath, sqlCreateRoles, {encoding: 'utf8'}) ;

    const excludedSchemas = await getExcludedSchema(appName) ;

    return await new Promise((resolve, reject)=>{
        const dump = spawn('pg_dump', [
            `-d${appName}`, 
            `-h${process.env.DB_HOST}`, 
            `-p${process.env.DB_PORT}`, 
            `-U${process.env.DB_USER}`,
        ].concat(excludedSchemas.map(s=>`--exclude-schema=${s}`)), {env: {PGPASSWORD: process.env.DB_PASSWORD}});
    
        //append to the backup file
        const outputStream = createWriteStream(backupDataPath, { flags: 'a' });
    
        // redirect stdout to the file
        dump.stdout.pipe(outputStream);
    
        let stderr = "" ;
        // Keep error message
        dump.stderr.on('data', (data) => {
            stderr += data+"\n" ;
        });
    
        // Wait process to finish
        dump.on('close', (code) => {
            if (code === 0) {
                // success
                resolve({
                    filePath: filePath,
                }) ;
            } else {
                reject({ code, stderr }) ;
            }
        });
    })
}


export async function restoreDatabase({restore, appName, query, logger}) {

    const excludedSchemas = await getExcludedSchema(appName) ;

    const result = await query("select schema_name from information_schema.schemata") ;
    for(let res of result.rows){
        const schemaName = res.schema_name ;
        if(!excludedSchemas.includes(schemaName)){
            logger.info(`Drop schema ${appName}.${schemaName}`) ;
            await query(`DROP SCHEMA "${schemaName}" CASCADE`);
        }
    }

    await query(`CREATE SCHEMA public`);
    
    const backupDir = path.join(process.env.DATA_DIR, "restore", appName);
    const backupDataPath = path.join(backupDir, restore.file_path) ;

       
    return await new Promise((resolve, reject)=>{

        const psql = spawn('psql', [
            `-d${appName}`, 
            `-h${process.env.DB_HOST}`, 
            `-p${process.env.DB_PORT}`, 
            `-U${process.env.DB_USER}`,
            `-f${backupDataPath}`,
        ], {env: {PGPASSWORD: process.env.DB_PASSWORD}});
       
        /*psql.stdout.on('data', function (data) {
             logger.info('Backup stdout: ' + data);
        });*/

        let stderr = "" ;
        // Keep error message
        psql.stderr.on('data', (data) => {
            stderr += data+"\n" ;
        });

        psql.on('close', function (code) {
            if (code === 0) {
                // success
                resolve({}) ;
            } else {
                reject({ code, stderr }) ;
            }
        }) ;
    })
}