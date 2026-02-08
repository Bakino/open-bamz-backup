import { exec } from 'child_process';
import { mkdir } from 'fs/promises';
import path from 'path';
import fs from 'fs-extra';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function backupSources({backup, appName}) {

    const sourceDir = path.join(process.env.DATA_DIR, "apps");

    const backupDir = path.join(process.env.DATA_DIR, "backups", appName);
    const filePath = path.join(backup.type, backup._id, `backup_sources_${appName}_${new Date().toISOString().replace(/[T:.]/g, "-")}.tar.gz`) ;
    const backupDataPath = path.join(backupDir, filePath) ;
    await mkdir(path.dirname(backupDataPath), { recursive: true });

    const {stdout, stderr} = await execAsync(`tar -czf "${backupDataPath}" -C "${sourceDir}" --exclude="${appName}/.ssh" --exclude="${appName}/.vscode-server" "${appName}" `)

    if(stderr){
        throw stderr;
    }

    return {
        filePath,
        stdout
    }

}

export async function restoreSources({restore, appName}) {

    const sourceDir = path.join(process.env.DATA_DIR, "apps", appName);

    const backupDir = path.join(process.env.DATA_DIR, "restore", appName);
    const fileDir = path.join(backupDir, restore.type, restore._id);
    //const filePath = path.join(fileDir, restore.file_path) ;
    //const backupDataPath = path.join(backupDir, filePath) ;
    

    const {stdout, stderr} = await execAsync(`tar -xzf "${path.basename(restore.file_path)}"`, {cwd: fileDir}) ;

    if(stderr){ throw stderr ; }

    const extractedFolder = path.join(fileDir, appName) ;

    await fs.remove(sourceDir) ;

    await fs.move(extractedFolder, sourceDir) ;

    //console.log(filePath) ;

    return {
        stdout
    }

}