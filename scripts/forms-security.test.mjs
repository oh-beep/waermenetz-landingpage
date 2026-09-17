import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import test from 'node:test';
const source=readFileSync('google-apps-script.js','utf8');
function runtime({key='',token='',status=201}={}) {
  const sent=[], rows=[];
  const props={BREVO_API_KEY:key,BREVO_WEBHOOK_TOKEN:token};
  const sheet={appendRow:row=>rows.push(row)};
  const context=createContext({console:{log(){}}, PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})}, ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})}, SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet})},UrlFetchApp:{fetch:(url,args)=>{sent.push({url,args});return {getResponseCode:()=>status,getContentText:()=>''};}},MailApp:{sendEmail:()=>sent.push({notification:true})},Utilities:{sleep(){}}});
  new Script(source).runInContext(context);
  return {call:(name,...args)=>JSON.parse(context[name](...args).text),rows,sent};
}
test('public or unconfigured webhook and GET never trigger welcome messages',()=>{
  for(const settings of [{},{key:'synthetic',token:'expected'}]){
    const r=runtime(settings);
    assert.equal(r.call('doPost',{postData:{contents:JSON.stringify({event:'listAddition',email:'synthetic@example.invalid',list_id:[3]})}}).success,false);
    assert.equal(r.call('doGet',{parameter:{action:'welcome',email:'synthetic@example.invalid'}}).error,'post_required');
    assert.equal(r.sent.length,0);
  }
});
test('authenticated webhook requires provider acceptance and valid address',()=>{
  const data={event:'listAddition',email:'synthetic@example.invalid',list_id:[3],webhookToken:'expected'};
  for(const status of [201,503]){
    const r=runtime({key:'synthetic',token:'expected',status});
    assert.equal(r.call('doPost',{postData:{contents:JSON.stringify(data)}}).success,status===201);
    assert.equal(r.sent.length,1);
  }
});
test('newsletter never records DOI sent when provider is absent or fails',()=>{
  for(const settings of [{},{key:'synthetic',status:503}]){
    const r=runtime(settings);
    assert.equal(r.call('handleNewsletter',{email:'synthetic@example.invalid'}).success,false);
    assert.equal(r.rows.length,0);
  }
  const r=runtime({key:'synthetic'});
  assert.equal(r.call('handleNewsletter',{email:'synthetic@example.invalid'}).success,true);
  assert.equal(r.rows[0][3],'DOI angefordert');
});
test('contact data is stored as text instead of executable sheet formulas',()=>{
  const r=runtime();
  assert.equal(r.call('handleContactForm',{email:'synthetic@example.invalid',vorname:'=1+1',nachricht:'  @SUM(A1)',telefon:'+49123'}).success,true);
  assert.equal(r.rows[0][1],"'=1+1");assert.equal(r.rows[0][9],"'  @SUM(A1)");assert.equal(r.rows[0][4],"'+49123");
});
test('static pages and scripts parse; local resources exist; opaque transport does not claim receipt',()=>{
  for(const file of ['index.html','impressum.html','datenschutz.html']){
    const html=readFileSync(file,'utf8');
    for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {if(match[1].trim() && !match[0].includes('application/ld+json')) new Script(match[1]);}
    for(const [,url] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
      if(/^(?:https?:|\/\/|#|mailto:|tel:|data:)/.test(url))continue;
      const local=url.split(/[?#]/)[0];if(local) assert.ok(existsSync(local),`${file}: ${local}`);
    }
  }
  const html=readFileSync('index.html','utf8');
  assert.match(html,/reportValidity\(\)/);assert.doesNotMatch(html,/Wir haben Ihre Anfrage erhalten|E-Mail, die wir Ihnen gerade gesendet haben/);
});
