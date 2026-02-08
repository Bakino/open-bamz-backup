//Script goes here

const {codeToHtml} = await import('https://esm.sh/shiki@3.0.0')

async function doHighlight(){
    let codeEls = view.querySelectorAll('code[lang]') ;
    for(let codeEl of codeEls){
        if(codeEl.hasAttribute("code-rendered")){
            continue ;
        }
        codeEl.setAttribute("code-rendered", "done") ;
        let lang = codeEl.getAttribute("lang") ; 
        //let comment = Array.prototype.find.call(codeEl.childNodes,n=>n.nodeName === "#comment")
        let comment = Array.prototype.find.call(codeEl.childNodes,n=>n.tagName === "PRE")
        if(comment){
            let codeStr = comment.textContent.trim();//.replace(/^\s*\n+/, "").replace(/\n+\s*$/, "").replace(/!--/g, "<!--").replace(/--!/g, "-->") ; ;
            if(!codeStr){
                const commentNode = Array.from(comment.childNodes).find(n=>n.nodeName === "#comment") ;
                if(commentNode){
                    codeStr = commentNode.textContent;
                }
            }
            //let codeStr = codeEl.innerText;

            //remove indentation
            let regexp = new RegExp(/^(\s*)/, "m") ;
            let result = codeStr.match(regexp);
            if(result && result[1]){
                codeStr = codeStr.replace(new RegExp("\n"+result[1]+"", "g"), "\n") ;
            }
            codeStr = codeStr.replaceAll("&dollar;", "$")
            codeStr = codeStr.trim() ;

            let button = document.createElement("BUTTON") ;
            button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-clipboard" viewBox="0 0 16 16">
                <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1z"/>
                <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0z"/>
            </svg>` ;
            button.className = "border p-1 cursor-pointer position-absolute" ;
            button.style.top = "2px"
            button.style.right = "2px"
            button.addEventListener("click", async ()=>{
                await navigator.clipboard.writeText(codeStr);
            });

            codeEl.classList.add("position-relative") ;
            codeEl.classList.add("d-block") ;
            
            if(lang === "json"){
                lang = "javascript" ;
            }
            const codeDiv = document.createElement("DIV") ;
            codeDiv.style.backgroundColor = "#292D3E";
            codeDiv.style.padding = "5px 32px 5px 5px";
            codeDiv.innerHTML = await codeToHtml(codeStr, { lang: lang, theme: 'material-theme-palenight' })
            codeEl.innerHTML = "";
            codeEl.appendChild(button);
            codeEl.appendChild(codeDiv);            
        }
    }
}

view.loader = async ()=>{
    const backups = await dbApi.db.backup.backup.search({}, {first: 50, orderBy: ['CREATE_TIME_DESC']})
    const restores = await dbApi.db.backup.restore.search({}, {first: 50, orderBy: ['CREATE_TIME_DESC']})
    const settings = await dbApi.db.backup.settings.searchFirst() ;

    return { 
        backups,
        restores,
        settings,
        type: "database"
    } ;
}

view.displayed = async ()=>{

    //join the socket room backup
    if(view.socketio){
        view.socketio.join("backup");
        view.socketio.on("backup-updated", (backup)=>{
            console.log("backup updated !", backup) ;
            view.refresh() ;
        }) 
    }

    const scrollSpy = new bootstrap.bootstrap.ScrollSpy(document.body, {
        target: '#navbar'
    }) ;

    const links = view.getElementById("navbar").querySelectorAll("a");
    for(let link of links){
        link.addEventListener("click", ev=>{
            ev.preventDefault();
            ev.stopPropagation() ;
            view.getElementById(link.getAttribute("href").replace("#", "")).scrollIntoView() ;
        }) ;
    }

    doHighlight();

   
}

view.startBackup = async ()=>{
    const backup = await dbApi.db.backup.backup.create({type: view.data.type}) ;
    dialogs.info(`The backup id ${backup._id} will now run in background.`) ;
    await view.refresh() ;
}

view.downloadBackup = async (backup)=>{
    window.open(`/open-bamz-backup/download_backup/${backup._id}`) ;
}
view.deleteBackup = async (backup)=>{
    await dbApi.db.backup.backup.updateBy_id(backup._id, {status: "deleted"}) ;
    await view.refresh() ;
}

view.saveSettings = async ()=>{
    const settings = view.data.settings;
    await dbApi.db.backup.settings.updateById(settings.id, settings) ;
    await view.refresh() ;
}

view.restoreBackup = async ()=>{
    await bamz.multipartPost(`/open-bamz-backup/upload_restore/${view.data.type}`, {file: view.data.restore_file})
    
    await view.refresh() ;
}

view.downloadRestore = async (restore)=>{
    window.open(`/open-bamz-backup/download_restore/${restore._id}`) ;
}