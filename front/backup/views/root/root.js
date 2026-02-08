//Script goes here


view.loader = async ()=>{
   
    return {
    }
};

function initSidebar(){
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('toggleBtn');
    const mainContent = document.getElementById('mainContent');

    // Par défaut, ouvert
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('closed');
        mainContent.classList.toggle('sidebar-closed');
        
        // Changement de la flèche
        toggleBtn.textContent = sidebar.classList.contains('closed') ? '→' : '←';
    });
}

view.displayed = ()=>{
    initSidebar() ;
    document.addEventListener("changeView", ev=>{
        //view.data.currentView = ev.detail ;
        window.location.hash = "#"+ev.detail;
    })
}
