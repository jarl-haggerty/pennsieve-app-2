const sortIntegrations = (integrations) => {
  return integrations.sort((a, b) => a.displayName.localeCompare(b.name, 'en', { numeric: true}))
}

const initialState = () => ({
  integrations: [],
})

export const state = initialState()

export const mutations = {
  CLEAR_STATE(state) {
    //reset all state to initial state
    const _initialState = initialState()
    // need to iteratively set keys to preserve reactivity
    Object.keys(_initialState).forEach(key => state[key] = _initialState[key])
  },

  UPDATE_INTEGRATIONS(state, integrations) {
    state.integrations = sortIntegrations(integrations)
  },

  CREATE_INTEGRATION(state, integration) {
    state.integrations.push(integration)
  }
}

export const actions = {
  updateIntegrations: ({commit}, data) => commit('UPDATE_INTEGRATIONS', data),

  fetchIntegrations: async({ commit, rootState }) => {
    try {
      const url = `${rootState.config.apiUrl}/webhooks?api_key=${rootState.userToken}`

      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (resp.ok) {
        const collections = await resp.json()
        commit('UPDATE_INTEGRATIONS', collections)
      } else {
        return Promise.reject(resp)
      }
    } catch (err) {
      commit('UPDATE_INTEGRATIONS', [])
      return Promise.reject(err)
    }
  },

  createIntegration: async ({commit, rootState, dispatch}, { datasetId, integration }) => {
    try {
      const url = `${rootState.config.apiUrl}/webhooks?api_key=${rootState.userToken}`

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(integration)
      })

      if (resp.ok) {
        const collection = await resp.json()
        commit('CREATE_COLLECTION', collection)

        dispatch('addCollection', { datasetId, collectionId: collection.id })
      } else {
        return Promise.reject(resp)
      }
    } catch (err) {
      return Promise.reject(err)
    }
  },

  removeCollection: async({ commit, dispatch, rootState }, { integrationId }) => {
    try {
      const url = `${rootState.config.apiUrl}/webhooks/${integrationId}?api_key=${rootState.userToken}`

      const resp = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (resp.ok) {
        /**
         * Need to fetch collections again in the chance that
         * this collection was the deleted from the organization.
         * This happens when a collection is removed and it wasn't
         * assigned to another dataset.
         */
        dispatch('fetchCollections')
      } else {
        return Promise.reject(resp)
      }
    } catch (err) {
      return Promise.reject(err)
    }
  },

}

export const getters = {}

const integrationsModule = {
  namespaced: true,
  state,
  mutations,
  actions,
  getters
}

export default integrationsModule
