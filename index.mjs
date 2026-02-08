import {backupDatabase, initDatabaseBackup, restoreDatabase} from "./database/databaseBackup.mjs";
import { init } from "./backupers.mjs";
import express from "express";
import fs from "fs-extra";
import path from 'path';
import {backupSources, restoreSources} from "./sources/sourcesBackup.mjs";
import multer from "multer";
import { randomUUID } from "crypto";




export const prepareDatabase = async ({ client, grantSchemaAccess }) => {
    //console.log(`CREATE SCHEMA IF NOT EXISTS users`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS backup`);


     // Settings
    await client.query(`CREATE TABLE IF NOT EXISTS backup.settings(
        id int PRIMARY KEY,
        expire_delay int DEFAULT 60      -- delay before expire a backup (in minutes)
    )`);

    await client.query(`INSERT INTO backup.settings(id, expire_delay)
        SELECT 1, 60
        WHERE NOT EXISTS (SELECT * FROM backup.settings)`);
    
    await client.query(`DO $$ BEGIN
            CREATE TYPE backup.status AS ENUM ('todo', 'inprogress', 'done', 'failed', 'expired', 'deleted') ;
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;`);

    
    await client.query(`CREATE TABLE IF NOT EXISTS backup.backup(
        _id uuid primary key DEFAULT gen_random_uuid(),
        create_time timestamp without time zone DEFAULT now(),
        start_time timestamp without time zone,
        end_time timestamp without time zone,
        type text not null,
        status backup.status DEFAULT 'todo',
        file_path text,
        error text
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS backup.backup_log(
        _id uuid primary key DEFAULT gen_random_uuid(),
        backup_id uuid REFERENCES backup.backup(_id),
        create_time timestamp without time zone DEFAULT now(),
        type text,
        message text,
        data jsonb
    )`);

    await client.query(`CREATE OR REPLACE FUNCTION backup.trigger_start_backup()
        RETURNS TRIGGER AS $$
            plv8.execute("INSERT INTO backup.backup_log(backup_id, type, message) VALUES ($1, $2, $3)", 
                    [NEW._id, "created", "Backup request created"]);
            plv8.execute("SELECT graphile_worker.add_job('runPluginTask', $1)", 
                [{plugin: 'open-bamz-backup', task : 'tasks/backup.mjs', params: {backupId: NEW._id}}]);

            const settings = plv8.execute("SELECT * FROM backup.settings")[0] ;

            if(settings && settings.expire_delay>0){
                plv8.execute("SELECT graphile_worker.add_job('runPluginTask', $1, 'expire_backup', $2)", 
                    [{plugin: 'open-bamz-backup', task : 'tasks/expireBackup.mjs', params: {backupId: NEW._id}}, new Date(Date.now()+(settings.expire_delay*60*1000))]);
            }

        $$ LANGUAGE "plv8" SECURITY DEFINER`)

    await client.query(`CREATE OR REPLACE TRIGGER trigger_start_backup
    AFTER INSERT
    ON backup.backup FOR EACH ROW
    EXECUTE PROCEDURE backup.trigger_start_backup()`)

    await client.query(`CREATE OR REPLACE FUNCTION backup.trigger_delete_file()
        RETURNS TRIGGER AS $$
            if(NEW.status === 'expired' || NEW.status === 'deleted'){
                plv8.execute("INSERT INTO backup.backup_log(backup_id, type, message) VALUES ($1, $2, $3)", 
                        [NEW._id, "delete_file", "Backup delete file request created"]);
                plv8.execute("SELECT graphile_worker.add_job('runPluginTask', $1)", 
                    [{plugin: 'open-bamz-backup', task : 'tasks/deleteBackupFile.mjs', params: {backupId: NEW._id}}]);
            }
            return NEW ;
        $$ LANGUAGE "plv8" SECURITY DEFINER`)

    await client.query(`CREATE OR REPLACE TRIGGER trigger_delete_file
    AFTER UPDATE
    ON backup.backup FOR EACH ROW
    EXECUTE PROCEDURE backup.trigger_delete_file()`)


    await client.query(`CREATE TABLE IF NOT EXISTS backup.restore(
        _id uuid primary key DEFAULT gen_random_uuid(),
        create_time timestamp without time zone DEFAULT now(),
        start_time timestamp without time zone,
        end_time timestamp without time zone,
        type text not null,
        status backup.status DEFAULT 'todo',
        file_path text,
        error text
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS backup.restore_log(
        _id uuid primary key DEFAULT gen_random_uuid(),
        restore_id uuid REFERENCES backup.restore(_id),
        create_time timestamp without time zone DEFAULT now(),
        type text,
        message text,
        data jsonb
    )`);

     await client.query(`CREATE OR REPLACE FUNCTION backup.trigger_start_restore()
        RETURNS TRIGGER AS $$
            plv8.execute("INSERT INTO backup.restore_log(restore_id, type, message) VALUES ($1, $2, $3)", 
                    [NEW._id, "created", "Restore request created"]);
            plv8.execute("SELECT graphile_worker.add_job('runPluginTask', $1)", 
                [{plugin: 'open-bamz-backup', task : 'tasks/restore.mjs', params: {restoreId: NEW._id}}]);

        $$ LANGUAGE "plv8" SECURITY DEFINER`)

    await client.query(`CREATE OR REPLACE TRIGGER trigger_start_restore
    AFTER INSERT
    ON backup.restore FOR EACH ROW
    EXECUTE PROCEDURE backup.trigger_start_restore()`) ;

    await grantSchemaAccess("backup", [
        { role: "admin", level: "admin" },
        { role: "user", level: "none" },
        { role: "readonly", level: "none" },
    ]) ;

}

export const cleanDatabase = async ({ client }) => {
    await client.query(`DROP SCHEMA IF EXISTS backup CASCADE`);

}

export const initPlugin = async ({  hasCurrentPlugin,contextOfApp, logger, loadPluginData, runQuery }) => {
    const router = express.Router();

    router.get("/download_backup/:backupId", async (req, res, next)=>{
        try{
            let appName = req.appName;                   
            if(await hasCurrentPlugin(appName)){

                const { rows } = await runQuery({database: appName}, 
                    `SELECT * FROM backup.backup WHERE _id = $1`, [req.params.backupId]
                );

                if(rows.length === 0){
                    return res.status(400).end(`Unknown backup ${req.params.backupId}`) ;
                }

                const backupDir = path.join(process.env.DATA_DIR, "backups", appName);
                const filePath = path.join(backupDir, rows[0].file_path) ;
                res.setHeader('Content-Disposition', `attachment; filename=${path.basename(filePath)}`);
                res.sendFile(filePath) ;
            }else{
                next() ;
            }
        }catch(err){
            logger.error("Can't download backup %o", err)
            res.status(err.statusCode??500).end("Error download backup");
        }
    });

    router.get("/download_restore/:restoreId", async (req, res, next)=>{
        try{
            let appName = req.appName;                   
            if(await hasCurrentPlugin(appName)){

                const { rows } = await runQuery({database: appName}, 
                    `SELECT * FROM backup.restore WHERE _id = $1`, [req.params.restored]
                );

                if(rows.length === 0){
                    return res.status(400).end(`Unknown restore ${req.params.restoreId}`) ;
                }

                const backupDir = path.join(process.env.DATA_DIR, "restore", appName);
                const filePath = path.join(backupDir, rows[0].file_path) ;
                res.setHeader('Content-Disposition', `attachment; filename=${path.basename(filePath)}`);
                res.sendFile(filePath) ;
            }else{
                next() ;
            }
        }catch(err){
            logger.error("Can't download backup %o", err)
            res.status(err.statusCode??500).end("Error download backup");
        }
    });


    const storage = multer.diskStorage({
        destination: async function (req, file, cb) {
            const uuid = req.restoreUuid??randomUUID() ;
            req.restoreUuid = uuid;
            const backupDir = path.join(process.env.DATA_DIR, "restore", req.appName, req.params.type, uuid);
            await fs.ensureDir(backupDir) ;
            cb(null, backupDir)
        },
        filename: function (req, file, cb) {
            cb(null, file.originalname)
        }
    })
    const upload = multer({ storage: storage });
    router.post('/upload_restore/:type', upload.single('file'), async (req, res, next) => {
        try{
            let appName = req.appName;                   
            if(await hasCurrentPlugin(appName)){
                
                const filePath = path.join(req.params.type, req.restoreUuid, req.file.originalname) ;
                const { rows } = await runQuery({database: appName}, 
                    `INSERT INTO backup.restore(_id, type, status, file_path) values ($1, $2, $3, $4) RETURNING *`, [req.restoreUuid, req.params.type, 'todo', filePath]
                );

                res.json(rows[0])
            }else{
                next() ;
            }
        }catch(err){
            logger.error("Can't upload restore %o", err) ;
            if(req.restoreUuid){
                try{
                    await fs.remove(path.join(process.env.DATA_DIR, "restore", req.appName, req.params.type, req.restoreUuid))
                }catch(err){
                    logger.error(`Can't clean restore ${req.file} %o`, err) ;
                }
            }
            res.status(err.statusCode??500).end("Error upload restore");
        }
    });

    //give the context to the backuper factory
    init({appContext: contextOfApp}) ;
    initDatabaseBackup({appContext: contextOfApp}) ;

    loadPluginData(async ({pluginsData})=>{
        // register the backupers
        if(pluginsData?.["open-bamz-backup"]?.pluginSlots?.backupers){
            pluginsData?.["open-bamz-backup"]?.pluginSlots?.backupers.push( {
                type: "database",
                backup: backupDatabase,
                restore: restoreDatabase,
            }) ;
            pluginsData?.["open-bamz-backup"]?.pluginSlots?.backupers.push( {
                type: "sources",
                backup: backupSources,
                restore: restoreSources,
            }) ;
        }
    })


    return {
        // path in which the plugin provide its front end files
        frontEndPath: "front",
        //lib that will be automatically load in frontend
        //frontEndLib: "cordova.mjs",
        router: router,
        //menu entries
        menu: [
            {
                name: "admin", entries: [
                    { name: "Backup", link: "/plugin/open-bamz-backup/backup" }
                ]
            }
        ],
        pluginSlots: {
            backupers: [],
            backupDatabaseExcludeSchemas: []
        }
    }
}