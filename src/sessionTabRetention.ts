// Selection order is independent of the visual order of projects and tabs.
export class SessionTabRetention {
  private projects:string[]=[];
  private sessions:string[]=[];

  update(openTabs:ReadonlyMap<string,readonly string[]>,projectId:string,selectedId:string|null){
    const owners=new Map<string,string>();
    for(const [project,ids] of openTabs)for(const id of ids)owners.set(id,project);
    this.projects=this.projects.filter(project=>openTabs.get(project)?.length);
    this.sessions=this.sessions.filter(id=>owners.has(id));
    const known=new Set(this.sessions);
    for(const id of owners.keys())if(!known.has(id))this.sessions.push(id);
    if(selectedId&&owners.get(selectedId)===projectId){
      this.projects=[projectId,...this.projects.filter(project=>project!==projectId)];
      this.sessions=[selectedId,...this.sessions.filter(id=>id!==selectedId)];
    }
    const kept=new Set<string>();
    for(const project of this.projects.slice(0,3)){
      const current=this.sessions.find(id=>owners.get(id)===project);
      if(current)kept.add(current);
    }
    const others=this.sessions.filter(id=>!kept.has(id));
    return [...kept,...others.slice(0,3)];
  }
}
