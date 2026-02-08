import path from "path";
import fs from "fs-extra"

export default async function(payload, {query, logger, appName, io}){
    logger.info(`Start clean backup file ${payload.backupId}`)
    try{
        let result = await query(`SELECT * FROM backup.backup WHERE _id = $1`, [payload.backupId])
        if(result.rows.length === 0){
            logger.error(`Backup ${payload.backupId} not found`);
            return;
        }
        let backup = result.rows[0];
        if(backup.status !== "expired" && backup.status !== "deleted"){
            logger.error(`Backup ${payload.backupId} not expired or deleted`);
            return;
        }

        logger.info(`Clean backup ${payload.backupId} start`);
        await query(`INSERT INTO backup.backup_log(backup_id, type, message) VALUES ($1, $2, $3)`, 
        [payload.backupId, "clean_start", "Clean backup start"]);
        
        io().to(`${appName}-backup`).emit("backup-updated", backup);

        const backupDir = path.join(process.env.DATA_DIR, "backups", appName, backup.type, backup._id);

        try{
            await fs.remove(backupDir) ;

            await query(`INSERT INTO backup.backup_log(backup_id, type, message) VALUES ($1, $2, $3)`, 
                        [payload.backupId, "clean_done", "Clean backup done"]);
            io().to(`${appName}-backup`).emit("backup-updated", backup);
        }catch(err){
            logger.error(`Error while perform clean backup ${payload.backupId} : %o`, err);
            try{
                await query(`INSERT INTO backup.backup_log(backup_id, type, message, data) VALUES ($1, $2, $3, $4)`, 
                    [payload.backupId, "clean_error", "Error while cleaning backup", {error: err.message}]);
                io().to(`${appName}-backup`).emit("backup-updated", backup);
            }catch(err){
                logger.info(`Backup ${payload.backupId} update failed %o`, err);
            }
        }

    }catch(err){
        logger.error(`Error while perform backup ${payload.backupId} : %o`, err);
    }
}