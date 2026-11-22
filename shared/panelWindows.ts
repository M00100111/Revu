export type PanelWindow='chat'|'review';
export type PanelControl='minimize'|'maximize'|'isMaximized'|'close';

export interface PanelWindowApi {
  focus(target:PanelWindow|'main'):Promise<void>;
  close(panel:PanelWindow):Promise<void>;
  control(panel:PanelWindow,action:PanelControl):Promise<boolean>;
  onRequestMerge(listener:(panel:PanelWindow)=>void):()=>void;
  onMaximized(listener:(panel:PanelWindow,maximized:boolean)=>void):()=>void;
}
