import { Decoration } from '../decoration'
import { LuaReturn, LuaState } from '../types'
import { decorateFunction } from './function'
import Global from '../global'
import MultiReturn from '../multireturn'
import RawResult from '../raw-result'
import Thread from '../thread'
import TypeExtension from '../type-extension'

class PromiseTypeExtension<T = unknown> extends TypeExtension<Promise<T>> {
    private gcPointer: number

    public constructor(thread: Global, injectObject: boolean) {
        super(thread, 'js_promise')

        this.gcPointer = thread.lua.module.addFunction((functionStateAddress: LuaState) => {
            // Throws a lua error which does a jump if it does not match.
            const userDataPointer = thread.lua.luaL_checkudata(functionStateAddress, 1, this.name)
            const referencePointer = thread.lua.module.getValue(userDataPointer, '*')
            thread.lua.unref(referencePointer)

            return LuaReturn.Ok
        }, 'ii')

        if (thread.lua.luaL_newmetatable(thread.address, this.name)) {
            const metatableIndex = thread.lua.lua_gettop(thread.address)

            // Mark it as uneditable
            thread.lua.lua_pushstring(thread.address, 'protected metatable')
            thread.lua.lua_setfield(thread.address, metatableIndex, '__metatable')

            // Add the gc function
            thread.lua.lua_pushcclosure(thread.address, this.gcPointer, 0)
            thread.lua.lua_setfield(thread.address, metatableIndex, '__gc')

            const checkSelf = (self: Promise<any>): true => {
                if (Promise.resolve(self) !== self) {
                    throw new Error('promise method called without self instance')
                }
                return true
            }
            checkSelf(self)
            
            let promiseResult: { status: 'fulfilled' | 'rejected'; value: any } | undefined = undefined

            thread.lua.lua_yield(thread.address, 0);
             const awaitPromise = self
                            .then((res) => {
                                promiseResult = { status: 'fulfilled', value: res }
                            })
                            .catch((err) => {
                                promiseResult = { status: 'rejected', value: err }
                            })
              if (!promiseResult) {
                thread.pushValue(null);
                return thread.lua.lua_resume(thread.address,null,0);
              }
            if (promiseResult.value instanceof RawResult) {
                                return promiseResult.value.count
                            } else if (promiseResult.value instanceof MultiReturn) {
                                for (const arg of promiseResult.value) {
                                    thread.pushValue(arg)
                                }
                                return promiseResult.value.length
                            } else {
                                thread.pushValue(promiseResult.value)
                                return 1
                            }
            thread.pushValue(awaitPromise)
            return new RawResult(thread.lua.lua_resume(thread.address,null,0)))
        }
        // Pop the metatable from the stack.
        thread.lua.lua_pop(thread.address, 1)

        if (injectObject) {
            // Lastly create a static Promise constructor.
            thread.set('Promise', {
                create: (callback: ConstructorParameters<PromiseConstructor>[0]) => new Promise(callback),
                all: (promiseArray: any) => {
                    if (!Array.isArray(promiseArray)) {
                        throw new Error('argument must be an array of promises')
                    }

                    return Promise.all(promiseArray.map((potentialPromise) => Promise.resolve(potentialPromise)))
                },
                resolve: (value: any) => Promise.resolve(value),
            })
        }
    }

    public close(): void {
        this.thread.lua.module.removeFunction(this.gcPointer)
    }

    public pushValue(thread: Thread, decoration: Decoration<Promise<T>>): boolean {
        if (Promise.resolve(decoration.target) !== decoration.target) {
            return false
        }
        return super.pushValue(thread, decoration)
    }
}

export default function createTypeExtension<T = unknown>(thread: Global, injectObject: boolean): TypeExtension<Promise<T>> {
    return new PromiseTypeExtension<T>(thread, injectObject)
}
