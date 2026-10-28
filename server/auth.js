import { Router } from 'express';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createAccount, createSession, deleteSession, findAccount, sessionUser, userById } from './store.js';

const scrypt=promisify(scryptCallback);
const COOKIE='worklog_session';
const SESSION_DAYS=30;
const publicUser=u=>({id:u.id,email:u.email,display_name:u.display_name,created_at:u.created_at});
const hashToken=token=>createHash('sha256').update(token).digest('hex');
const cookieOptions=`HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS*24*60*60}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`;
function cookieToken(req){
 const entry=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`));
 return entry?decodeURIComponent(entry.slice(COOKIE.length+1)):'';
}
function setSessionCookie(res,token){res.setHeader('Set-Cookie',`${COOKIE}=${encodeURIComponent(token)}; ${cookieOptions}`)}
function clearSessionCookie(res){res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.COOKIE_SECURE==='true'?'; Secure':''}`)}
async function passwordHash(password){
 const salt=randomBytes(16);const key=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
 return `scrypt$${salt.toString('hex')}$${Buffer.from(key).toString('hex')}`;
}
async function passwordMatches(password,stored){
 try{const [scheme,saltHex,keyHex]=stored.split('$');if(scheme!=='scrypt')return false;const salt=Buffer.from(saltHex,'hex'),expected=Buffer.from(keyHex,'hex');const actual=Buffer.from(await scrypt(password,salt,expected.length,{N:16384,r:8,p:1,maxmem:64*1024*1024}));return actual.length===expected.length&&timingSafeEqual(actual,expected)}catch{return false}
}
function issueSession(res,user){
 const token=randomBytes(32).toString('base64url');const expires=new Date(Date.now()+SESSION_DAYS*24*60*60*1000).toISOString();
 createSession(hashToken(token),user.id,expires);setSessionCookie(res,token);
}

export const authRouter=Router();
authRouter.post('/signup',async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase();const displayName=String(req.body.display_name||'').trim();const password=String(req.body.password||'');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return res.status(400).json({error:'Enter a valid email address.'});
 if(displayName.length<2||displayName.length>80)return res.status(400).json({error:'Name must be between 2 and 80 characters.'});
 if(password.length<10||password.length>256)return res.status(400).json({error:'Password must be between 10 and 256 characters.'});
 try{const user=createAccount({email,displayName,passwordHash:await passwordHash(password)});issueSession(res,user);res.status(201).json(publicUser(user))}
 catch(e){if(e.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'An account with that email already exists.'});res.status(500).json({error:'Could not create the account.'})}
});
authRouter.post('/signin',async(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase();const password=String(req.body.password||'');
 const user=findAccount(email);
 if(!user||password.length>256||!await passwordMatches(password,user.password_hash))return res.status(401).json({error:'Email or password is incorrect.'});
 issueSession(res,user);res.json(publicUser(user));
});
authRouter.get('/me',(req,res)=>{
 const token=cookieToken(req);const user=token&&sessionUser(hashToken(token));
 if(!user){clearSessionCookie(res);return res.status(401).json({error:'Sign in to continue.'})}
 res.json(publicUser(user));
});
authRouter.post('/signout',(req,res)=>{
 const token=cookieToken(req);if(token)deleteSession(hashToken(token));clearSessionCookie(res);res.status(204).end();
});
export function requireAuth(req,res,next){
 const token=cookieToken(req);const user=token&&sessionUser(hashToken(token));
 if(!user)return res.status(401).json({error:'Your session has ended. Please sign in again.'});
 req.user=user;next();
}
