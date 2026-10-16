// Names describe the catalog entry; IDs remain unchanged for permissions and routing.
export function modelLabel(models: {id:string;provider?:string;displayName?:string}[], id: string) {
 const model=models.find(item=>item.id===id);
 if(model?.provider==='api'&&model.displayName?.trim())return model.displayName;
 if(!['qoder','workbuddy','trae'].includes(model?.provider??'')||!model?.displayName?.trim())return id;
 const name=model.displayName.trim().replace(/\s*\(Qoder\)$/i,'').replace(/\s+/g,'-');
 return `${model.provider}/${name}`;
}
