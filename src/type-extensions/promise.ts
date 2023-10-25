import { Decoration } from '../decoration'
import { LuaReturn, LuaState } from '../types'
import Global from '../global'
import Thread from '../thread'
import TypeExtension from '../type-extension'

class PromiseTypeExtension<T = unknown> extends TypeExtension<Promise<T>> {
    private gcPointer: number

    public constructor(thread: Global, injectObject: boolean) {
        super(thread, 'js_promise')

        this.gcPointer = thread.lua.module.addFunction((functionStateAddress: LuaState) => {
            const userDataPointer = thread.lua.luaL_checkudata(functionStateAddress, 1, this.name)
            const referencePointer = thread.lua.module.getValue(userDataPointer, '*')
            thread.lua.unref(referencePointer)
            return LuaReturn.Ok
        }, 'ii')

        if (thread.lua.luaL_newmetatable(thread.address, this.name)) {
            const metatableIndex = thread.lua.lua_gettop(thread.address)

            thread.lua.lua_pushstring(thread.address, 'protected metatable')
            thread.lua.lua_setfield(thread.address, metatableIndex, '__metatable')

            thread.lua.lua_pushcclosure(thread.address, this.gcPointer, 0)
            thread.lua.lua_setfield(thread.address, metatableIndex, '__gc')

            thread.pushValue((self: Promise<unknown>, other: Promise<unknown>) => self === other)
            thread.lua.lua_setfield(thread.address, metatableIndex, '__eq')
        }
        thread.lua.lua_pop(thread.address, 1)

        if (injectObject) {
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

        decoration.target
            .then((res) => {
                thread.pushValue(res); // Push the result onto the Lua stack
                thread.lua.lua_resume(thread.address, null,0, 1);
            })
            .catch((err) => {
                thread.pushValue(err); // Push the error onto the Lua stack
                thread.lua.lua_resume(thread.address, null,0, 1);
            });
            
        thread.lua.lua_yield(thread.address, 0);
        return true;
    }
}

export default function createTypeExtension<T = unknown>(thread: Global, injectObject: boolean): TypeExtension<Promise<T>> {
    return new PromiseTypeExtension<T>(thread, injectObject)
}
