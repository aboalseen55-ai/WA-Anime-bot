// Local-only preview using isolated in-memory fixtures. Never starts WhatsApp or connects to MongoDB.
import http from 'node:http';
import { createDashboardHandler } from '../services/dashboardServer.js';
import Kingdom from '../database/kingdomModel.js';
import User from '../database/userModel.js';
import Command from '../database/dashboardCommandModel.js';
import Api from '../database/dashboardApiModel.js';
import Template from '../database/dashboardTemplateModel.js';
import Audit from '../database/kingdomAuditLogModel.js';
import Usage from '../database/samBotUsageModel.js';
import Mafia from '../database/mafiaSessionModel.js';
import Bank from '../database/bankModel.js';

const chain=value=>{const result={lean:async()=>value};for(const name of ['sort','limit','skip','select'])result[name]=()=>result;return result};
const kingdom={_id:'100000000000000000000001',id:'demo',name:'مملكة الاختبار',mainGroup:'123@g.us',adminGroup:'456@g.us',receptionGroup:'789@g.us',workGroup:'987@g.us',groupIds:['123@g.us','456@g.us','789@g.us','987@g.us'],admins:['123@lid'],isActive:true,timeZone:'Asia/Amman',updatedAt:new Date().toISOString()};
const members=['سايتاما','ميكاسا','لوفي','ليفاي','إيتاتشي','غوجو'].map((nickname,i)=>({_id:'20000000000000000000000'+i,kingdom_id:'demo',nickname,jid:(100+i)+'@lid',role:i===0?'admin':'member',xp:1800-i*100,level:6-i,dailyMessages:86-i*10,dailyGameAnswers:21-i*3,dailyGameXp:100-i*12,dailyWelcomes:i===0?7:0,dailyRankStarsEarned:20,totalMessages:700-i*70,rankStarsByKingdom:{demo:500},coins:40,points:20,chatXp:1000,gameXp:800,gamesSessions:[],lastActivityAt:new Date()}));
let templates=[],commands=[],apis=[];
Kingdom.find=()=>chain([kingdom]);Kingdom.exists=async query=>query.id==='demo'?{_id:kingdom._id}:null;Kingdom.findOne=()=>chain(kingdom);Kingdom.updateOne=async(query,update)=>{Object.assign(kingdom,update.$set);return{matchedCount:1}};
User.find=()=>chain(members);User.countDocuments=async()=>members.length;User.aggregate=async pipeline=>pipeline.some(p=>p.$unwind)?[]:[{members:6,messages:3200,dailyMessages:356,answers:81,xp:9400,welcomes:7,stars:120}];Kingdom.countDocuments=async()=>1;
User.findOne=async query=>{const user=members.find(u=>u._id===query._id);if(!user)return null;user.save=async()=>user;return user};User.exists=async()=>null;
for(const Model of [Mafia,Usage,Audit]) {Model.find=()=>chain([]);Model.countDocuments=async()=>0;}
Audit.create=async value=>value;
Bank.find=()=>chain([{kingdom:'demo',totalCoins:1000000}]);Bank.aggregate=async()=>[{rows:[],count:[]}];
Template.find=()=>chain(templates);Template.updateOne=async({key},update)=>{templates=templates.filter(t=>t.key!==key);templates.push({key,text:update.$set.text});};Template.deleteOne=async({key})=>{templates=templates.filter(t=>t.key!==key)};
for(const [Model,get,set] of [[Command,()=>commands,value=>commands=value],[Api,()=>apis,value=>apis=value]]) {
  Model.find=()=>chain(get());Model.exists=async query=>query._id?get().find(row=>row._id===query._id):null;
  Model.create=async row=>{const created={...row,_id:crypto.randomUUID().replaceAll('-','').slice(0,24)};set([...get(),created]);return created;};
  Model.updateOne=async({_id},update)=>{Object.assign(get().find(row=>row._id===_id),update.$set);return{matchedCount:1}};
  Model.deleteOne=async({_id})=>{set(get().filter(row=>row._id!==_id));return{deletedCount:1}};
}
const port=Number(process.env.DASHBOARD_FIXTURE_PORT||4187);
process.env.DASHBOARD_ENCRYPTION_KEY='local-fixture-key-not-for-production';
http.createServer(createDashboardHandler({getBotStatus:()=>({connected:true}),getGroups:async()=>[{id:'123@g.us',name:'المجموعة الأساسية'},{id:'456@g.us',name:'مجموعة الإدارة'},{id:'789@g.us',name:'الاستقبال'},{id:'987@g.us',name:'الوورك'}],password:'dashboard-test-only'})).listen(port,'127.0.0.1',()=>console.log('Fixture dashboard http://127.0.0.1:'+port+'/dashboard'));
